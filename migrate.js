const { Octokit }  = require('@octokit/rest')
const fs = require('fs')
const csv = require('csv-parser')
const sodium = require('libsodium-wrappers')
const { get } = require('http')
const { exec } = require('child_process')
const { TIMEOUT } = require('dns')

const sourceRepo = { owner: process.env.SOURCE_ORG, repo: process.env.SOURCE_REPO }
const targetRepo = { owner: process.env.TARGET_ORG, repo: process.env.TARGET_REPO }

// console.log("Source Repo: ", sourceRepo)
// console.log("Target Repo: ", targetRepo)
// console.log("GH_PAT_SOURCE: ", process.env.GH_PAT_SOURCE)
// console.log("GH_PAT_TARGET: ", process.env.GH_PAT_TARGET)

// Set to true if you want to append the repo ID to the environment name
const addRepoID = false;

const octokitSource = new Octokit({
  auth: process.env.GH_PAT_SOURCE,
});

const octokitTarget = new Octokit({
  auth: process.env.GH_PAT_TARGET,
});

const secretValue = "temp"
let newEnvs = []

console.log("Migrating environments from source to target repo...");

async function migrateEnvironments() {
  const {data: environments} = await octokitSource.repos.getAllEnvironments(sourceRepo);
  //console.log("Environments: ", environments);

  let tempEnv = environments.environments;

  const repoId = await octokitTarget.rest.repos.get({
    owner: targetRepo.owner,
    repo: targetRepo.repo,
  });

  tempEnv = tempEnv.map(environment => {
    return {
      ...environment,
      repoID: repoId.data.id // replace 'yourRepoID' with the actual repoID
    };
  });

  //console.log("environments NEW: ", tempEnv);  

  let usersMap = new Map()
  try {
    usersMap = await generateUserMap()
    //console.log("user map: ")
    //console.log(usersMap)
  } catch(error) {
    console.error(error)
  }

  let reviewerList = []
  let envList = []

  for (const env of tempEnv) {
    //console.log("Environment: ", env)
    let wait_timer
    let envObj = { 
        env: env.name,
        reviewerList: reviewerList,
        prevent_self_review: false,
    };
    //let emuReviewersArray = []
    if (env.protection_rules) {
      // console.log("Protection rules: ")
      // console.log(env.protection_rules);
      for (const rule of env.protection_rules) {
        if (rule.type === 'wait_timer') {
          wait_timer = rule.wait_timer
        } else if (rule.type === 'required_reviewers'){
          //console.log(rule.reviewers);
          reviewerList = [];
          if (rule.prevent_self_review === true) {
            envObj.prevent_self_review = true;
          }
          for (const reviewer of rule.reviewers) {
            //console.log("reviewer:", reviewer.reviewer);
            //console.log("reviewer login:", reviewer.reviewer.login);
            reviewerList.push(reviewer.reviewer.login);
            // const userOBJSource = await gatherUserData(reviewer.reviewer.login, process.env.GH_PAT_SOURCE);
            // console.log("User email: ", userOBJSource.email)
            // if(usersMap.has(userOBJSource.email)) {
            //   console.log("Found a match for: ", reviewer.reviewer.login);
              //const userEmu = usersMap.get(userOBJ.email);
              // console.log(usersMap);
              // const userOBJTarget = await gatherUserData(usersMap.get(userOBJSource.email), process.env.GH_PAT_TARGET);
              // console.log("User Object Target: ", userOBJTarget);
              // console.log(userOBJTarget);
              // const userEmuId = userOBJTarget.id;
              // const userEmuType =  userOBJTarget.type;
              // console.log("Emu: ", userEmu)
              // console.log("User ID: ", userEmuId);
              // if (userOBJTarget.id > 0){
              //   emuReviewersArray.push({ id: userEmuId, type: userEmuType });
              // } else {
              //   console.log("User not found in target ORG: ", reviewer.reviewer.login);
              //   console.log("Adding to list on non-verified reviewers");
              //   reviewerList.push(reviewer.reviewer.login);
              // }
            // } else {
            //   console.log("No match found for: ", reviewer.reviewer.login);
            //   console.log("Adding to list on non-verified reviewers");
            //   reviewerList.push(reviewer.reviewer.login);
            // }
          }
          envObj.reviewerList = reviewerList;
          envList.push(envObj);
        }
      }
    }
    //console.log("reviewerList: ", reviewerList)
    env.wait_timer = wait_timer

    const protected_branches = env.deployment_branch_policy ? env.deployment_branch_policy.protected_branches : null
    const custom_branch_policies = env.deployment_branch_policy ? env.deployment_branch_policy.custom_branch_policies : null

    let envName = env.name;

    if (addRepoID === true) {
      envName = env.name + "-" + repoId.data.id;
      //console.log("Env Name: ", envName);
    }

    // Uncomment When Needed (Code used for custom reviewer mapping)
    // await octokitTarget.rest.repos.createOrUpdateEnvironment({
    //   owner: targetRepo.owner,
    //   repo: targetRepo.repo,
    //   environment_name: envName,
    //   deployment_branch_policy: env.deployment_branch_policy ? {
    //     protected_branches: protected_branches,
    //     custom_branch_policies: custom_branch_policies,
    //   } : null,
    //   wait_timer: env.wait_timer,
    //   ...(emuReviewersArray.length > 0 ? { reviewers: emuReviewersArray } : {})
    // });

    await octokitTarget.rest.repos.createOrUpdateEnvironment({
      owner: targetRepo.owner,
      repo: targetRepo.repo,
      environment_name: envName,
      deployment_branch_policy: env.deployment_branch_policy ? {
        protected_branches: protected_branches,
        custom_branch_policies: custom_branch_policies,
      } : null,
      wait_timer: env.wait_timer,
    });
  }

  // process.exit(0);

  const secrets = await getEnvironmentSecrets(tempEnv);
  const secretsEncrypt = await processEnvs(secrets, secretValue)
  await migrateSecrets(secretsEncrypt)
  
  const variables = await getEnvironmentVariables(tempEnv);
  await migrateVariables(variables)
  
  await generateIssuesForRequiredReviewers(envList)
  await generateIssuesForEnvironmentSecrets(secrets)
  console.log("Migration complete!")
}

async function generateUserMap() {
  let usersMap = new Map()
  return new Promise((resolve, reject) => {
    fs.createReadStream('users.csv')
    .pipe(csv())
    .on('data', (row) => {
      usersMap.set(row.saml_name_id, row.emu)
    })
    .on('end', () => {
      resolve(usersMap)
    })
  })
}

async function getEnvironmentSecrets(environments) {
  let envs = []
  let envName = '';

  for (const env of environments ) {
    envName = env.name;
    if (addRepoID === true) {
      envName = env.name + "-" + env.repoID;
      //console.log("Env Name: ", envName);
    }
    let envObj = {
      name: envName,
      secrets: [],
      key_id: '',
      key: '',
    }

    const repoId = await octokitSource.rest.repos.get({
      owner: sourceRepo.owner,
      repo: sourceRepo.repo,
    })

    const secretsResponse = await octokitSource.rest.actions.listEnvironmentSecrets({
      repository_id: repoId.data.id,
      environment_name: env.name,
    })

    const keyResponse = await octokitSource.rest.actions.getEnvironmentPublicKey({
      repository_id: repoId.data.id,
      environment_name: env.name,
    })

    envObj.key_id = keyResponse.data.key_id;
    envObj.key = keyResponse.data.key;

    for (const secret of secretsResponse.data.secrets) {
      const secretValue = await octokitSource.rest.actions.getEnvironmentSecret({
        repository_id: repoId.data.id,
        secret_name: secret.name,
        environment_name: env.name,
      })

      envObj.secrets.push({
        name: secret.name,
        value: secretValue.data,
      })

      envs.push(envObj)
    }
  }
  return envs
}

async function processEnvs(envs, secret) {
  for (const env of envs) {
    let envObj = {
      name: env.name,
      secrets: env.secrets,
      key_id: env.key_id,
      key: env.key,
      encrypted: '',
    }
    const key = env.key

    envObj.encrypted = await encryptSecrets(key, secret)
    newEnvs.push(envObj)
  }
  return newEnvs
}

async function encryptSecrets(key, secret) {
  const result = await sodium.ready.then(() => {
    let binKey = sodium.from_base64(key, sodium.base64_variants.ORIGINAL)
    let binSec = sodium.from_string(secret)
    let encBytes = sodium.crypto_box_seal(binSec, binKey)
    let output = sodium.to_base64(encBytes, sodium.base64_variants.ORIGINAL)
    return output
  })
  return result
}

async function migrateSecrets(secrets) {
  const repoId = await octokitTarget.rest.repos.get({
    owner: targetRepo.owner,
    repo: targetRepo.repo,
  })

  for (const env of secrets) {
    for (const sec of env.secrets) {
        await octokitTarget.rest.actions.createOrUpdateEnvironmentSecret({
        repository_id: repoId.data.id,
        environment_name: env.name,
        secret_name: sec.name,
        encrypted_value: env.encrypted,
        key_id: env.key_id,
      })
    }
  }
}

async function getEnvironmentVariables(environments) {
  let envs = []
  let envName = '';

  for (const env of environments) {
    envName = env.name;
    if (addRepoID === true) {
      envName = env.name + "-" + env.repoID;
      //console.log("Env Name: ", envName);
    }
    let envObj = {
      name: envName,
      vars: [],
    }

    const repoId = await octokitSource.rest.repos.get({
      owner: sourceRepo.owner,
      repo: sourceRepo.repo,
    })

    const variablesResponse = await octokitSource.rest.actions.listEnvironmentVariables({
      repository_id: repoId.data.id,
      environment_name: env.name,
    })

    for (const variable of variablesResponse.data.variables) {
      envObj.vars.push({
        name: variable.name,
        value: variable.value,
      })
      envs.push(envObj)
    }
  }
  return envs
}

async function migrateVariables(variables) {
  for (const env of variables) {
    const repoId = await octokitTarget.rest.repos.get({
      owner: targetRepo.owner,
      repo: targetRepo.repo,
    })
    for (const variable of env.vars) {
      await octokitTarget.rest.actions.createEnvironmentVariable({
        repository_id: repoId.data.id,
        environment_name: env.name,
        name: variable.name,
        value: variable.value,
      })
    }
  }
}

async function generateIssuesForEnvironmentSecrets(secrets) {
  for (const env of secrets) {
    let issueBody = `Please add the following secrets for the \`${env.name}\` environment. Once the secrets have been added, please close this issue.\n`

    for (const sec of env.secrets) {
      issueBody += `- [ ] \`${sec.name}\`\n`;
    }

    await octokitTarget.rest.issues.create({
        owner: targetRepo.owner,
        repo: targetRepo.repo,
        title: 'Update secrets for environment: ' + `\`${env.name}\``,
        body: issueBody,
    });
  }
}

async function generateIssuesForRequiredReviewers(envList) {
  let reviewers = false

  for (const env of envList) {
    let issueBody = `Please add the following reviewers for the \`${env.env}\` environment. Once the reviewers have been added, please close this issue.\n`

    for (const reviewer of env.reviewerList) {
      issueBody += `- [ ] \`${reviewer}\`\n`;
      reviewers = true;
    }

    if (reviewers) {
      console.log("EnvName: ", env.env);
      const issueResult = await octokitTarget.rest.issues.create({
          owner: targetRepo.owner,
          repo: targetRepo.repo,
          title: 'Update reviewers for environment: ' + `\`${env.env}\``,
          body: issueBody,
      });
      //console.log(issueResult.data);
    }
  }
}

async function gatherUserData(login, token) {
  return new Promise((resolve, reject) => {
    const username = login;
    const command = `curl -H "Authorization: token ${token}" https://api.github.com/users/${username}`;

    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`exec error: ${error}`);
        reject(error);
        return;
      }

      const userData = JSON.parse(stdout);

      let userOBJ = {
        login: userData.login || '',
        id: userData.id || 0,
        type: userData.type || '',
        email: userData.email || '',
      };

      //console.log(`User Object in gatherUSerData Function: `, userOBJ);
      resolve(userOBJ);
    });
  });
}

migrateEnvironments().catch(console.error);
