const { Octokit }  = require('@octokit/rest')
const fs = require('fs')
const csv = require('csv-parser')
const sodium = require('libsodium-wrappers')
const { get } = require('http')
const { exec } = require('child_process')
const { TIMEOUT } = require('dns')

const sourceRepo = { owner: process.env.SOURCE_ORG, repo: process.env.SOURCE_REPO }
const targetRepo = { owner: process.env.TARGET_ORG, repo: process.env.TARGET_REPO }

// Test if your values are being read correctly
// console.log("Source Repo: ", sourceRepo)
// console.log("Target Repo: ", targetRepo)
// console.log("GH_PAT_SOURCE: ", process.env.GH_PAT_SOURCE)
// console.log("GH_PAT_TARGET: ", process.env.GH_PAT_TARGET)

// Set to true if you want to append the repo ID to the environment name
const addRepoID = false;

// Create Octokit instances for source and target repos
const octokitSource = new Octokit({
  auth: process.env.GH_PAT_SOURCE,
});

const octokitTarget = new Octokit({
  auth: process.env.GH_PAT_TARGET,
});

const secretValue = "temp" // Set the secret value to encrypt the secrets, temp is used since secrets cannot be migrated using this script
let newEnvs = [] // Needed to store the encrypted secrets

console.log("Migrating environments from source to target repo...");
// Console log exist all over the program, these can be uncommented to see the output of the program

// Function to migrate environments
async function migrateEnvironments() {
  const {data: environments} = await octokitSource.repos.getAllEnvironments(sourceRepo);
  //console.log("Environments: ", environments);

  // Create a copy of the environments object environments list
  let tempEnv = environments.environments;

  // Grab the repo ID for the target repo
  const repoId = await octokitTarget.rest.repos.get({
    owner: targetRepo.owner,
    repo: targetRepo.repo,
  });

  // Update environments to include REPO ID as a property
  tempEnv = tempEnv.map(environment => {
    return {
      ...environment,
      repoID: repoId.data.id // replace 'yourRepoID' with the actual repoID
    };
  });

  //console.log("environments NEW: ", tempEnv);  

  // Create new users map
  let usersMap = new Map()
  try {
    usersMap = await generateUserMap()
    //console.log("user map: ")
    //console.log(usersMap)
  } catch(error) {
    console.error(error)
  }

  // Create empty reviewer list and environment list for use in later functions
  let reviewerList = []
  let envList = []

  // itterate through the environments and create the environments in the target repo
  for (const env of tempEnv) {
    //console.log("Environment: ", env)
    let wait_timer
    // Create environment object to track info about each environment
    let envObj = { 
        env: env.name,
        reviewerList: reviewerList,
        prevent_self_review: false,
    };
    // let emuReviewersArray = []
    // check if code has protection rules
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

    // Assign boolean value to protected_branches and custom_branch_policies if they exist to add to new environment
    const protected_branches = env.deployment_branch_policy ? env.deployment_branch_policy.protected_branches : null
    const custom_branch_policies = env.deployment_branch_policy ? env.deployment_branch_policy.custom_branch_policies : null

    // used in case the environment name needs to be appended with the repo ID
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

    // Create the environment in the target repo
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

  // process.exit(0); // Exit program here for testing purposes to avoid running the rest of the program

  const secrets = await getEnvironmentSecrets(tempEnv); // Get the secrets from the source repo
  const secretsEncrypt = await processEnvs(secrets, secretValue) // Encrypt the secrets
  await migrateSecrets(secretsEncrypt) // Migrate the secrets to the target repo
  
  const variables = await getEnvironmentVariables(tempEnv); // Get the variables from the source repo
  await migrateVariables(variables) // Migrate the variables to the target repo
  
  await generateIssuesForRequiredReviewers(envList) // Generate issues for required reviewers
  await generateIssuesForEnvironmentSecrets(secrets) // Generate issues for environment secrets
  console.log("Migration complete!") // Log that the migration is complete
}

// Function to generate a map of users from csv file
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

// Function to get the secrets from the source repo
async function getEnvironmentSecrets(environments) {
  let envs = []
  let envName = '';

  for (const env of environments ) {
    envName = env.name;
    if (addRepoID === true) {
      envName = env.name + "-" + env.repoID;
      //console.log("Env Name: ", envName);
    }
    // Add new values to the env object to track the key and key_id
    let envObj = {
      name: envName,
      secrets: [],
      key_id: '',
      key: '',
    }

    // Get the repo ID for the source repo since it is needed to get the secrets
    const repoId = await octokitSource.rest.repos.get({
      owner: sourceRepo.owner,
      repo: sourceRepo.repo,
    })

    // list the secrets for the environment
    const secretsResponse = await octokitSource.rest.actions.listEnvironmentSecrets({
      repository_id: repoId.data.id,
      environment_name: env.name,
    })

    // Get the public key for the environment since it is needed to encrypt the secrets 
    const keyResponse = await octokitSource.rest.actions.getEnvironmentPublicKey({
      repository_id: repoId.data.id,
      environment_name: env.name,
    })

    // Add the key and key_id to the env
    envObj.key_id = keyResponse.data.key_id;
    envObj.key = keyResponse.data.key;

    // Get the encrypted value for each secret, even though the value is not needed, it is needed to encrypt the secrets
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

// Function to process the Environments and add encripted secrets to the object
async function processEnvs(envs, secret) {
  for (const env of envs) {
    // Create a new object to store the encrypted secrets
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

// Function to encrypt the secrets
async function encryptSecrets(key, secret) {
  // use libsodium to encrypt the secret since we need encrypted values to migrate the secrets
  const result = await sodium.ready.then(() => {
    let binKey = sodium.from_base64(key, sodium.base64_variants.ORIGINAL)
    let binSec = sodium.from_string(secret)
    let encBytes = sodium.crypto_box_seal(binSec, binKey)
    let output = sodium.to_base64(encBytes, sodium.base64_variants.ORIGINAL)
    return output
  })
  return result
}

// Function to migrate the secrets to the target repo
async function migrateSecrets(secrets) {
  // grab repo ID for the target repo 
  const repoId = await octokitTarget.rest.repos.get({
    owner: targetRepo.owner,
    repo: targetRepo.repo,
  })

  for (const env of secrets) {
    for (const sec of env.secrets) {
      // go through each secret and create or update the secret in the target repo
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

// Function to get the environment variables from the source repo
async function getEnvironmentVariables(environments) {
  let envs = []
  let envName = '';

  for (const env of environments) {
    envName = env.name;
    if (addRepoID === true) {
      envName = env.name + "-" + env.repoID;
      //console.log("Env Name: ", envName);
    }
    // add new values to env object to track the variables
    let envObj = {
      name: envName,
      vars: [],
    }

    // get the repo ID for the source repo since it is needed to get the variables
    const repoId = await octokitSource.rest.repos.get({
      owner: sourceRepo.owner,
      repo: sourceRepo.repo,
    })

    // list the variables for the environment
    const variablesResponse = await octokitSource.rest.actions.listEnvironmentVariables({
      repository_id: repoId.data.id,
      environment_name: env.name,
    })

    // get the value for each variable
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

// Function to migrate the variables to the target repo
async function migrateVariables(variables) {
  for (const env of variables) {
    // get the repo ID for the target repo
    const repoId = await octokitTarget.rest.repos.get({
      owner: targetRepo.owner,
      repo: targetRepo.repo,
    })
    for (const variable of env.vars) {
      // go through each variable and create or update the variable in the target repo
      await octokitTarget.rest.actions.createEnvironmentVariable({
        repository_id: repoId.data.id,
        environment_name: env.name,
        name: variable.name,
        value: variable.value,
      })
    }
  }
}

// Function to generate issues for the secrets since values cannot be migrated and would need to be added manually
async function generateIssuesForEnvironmentSecrets(secrets) {
  // go through each environment and create an issue for the secrets
  for (const env of secrets) {
    let issueBody = `Please add the following secrets for the \`${env.name}\` environment. Once the secrets have been added, please close this issue.\n`

    for (const sec of env.secrets) {
      issueBody += `- [ ] \`${sec.name}\`\n`;
    }

    // create an issue for the environment secrets
    await octokitTarget.rest.issues.create({
        owner: targetRepo.owner,
        repo: targetRepo.repo,
        title: 'Update secrets for environment: ' + `\`${env.name}\``,
        body: issueBody,
    });
  }
}

// Function to generate issues for required reviewers since the reviewers cannot be migrated and would need to be added manually
async function generateIssuesForRequiredReviewers(envList) {
  let reviewers = false

  // go through each environment and create an issue for the required reviewers
  for (const env of envList) {
    let issueBody = `Please add the following reviewers for the \`${env.env}\` environment. Once the reviewers have been added, please close this issue.\n`

    for (const reviewer of env.reviewerList) {
      issueBody += `- [ ] \`${reviewer}\`\n`;
      reviewers = true;
    }

    if (reviewers) {
      console.log("EnvName: ", env.env);
      // create an issue for the required reviewers, value is stored but not needed unless it is for testing purposes
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

// Function is only needed when correct permissions are given to the PAT, most likely org admin
async function gatherUserData(login, token) {
  // promise to get the user data since octokit does not have a function to get user data that works with EMU
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

      // user object to store the user data needed
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

// Call the function to migrate the environments and if an error occues, log the error
migrateEnvironments().catch(console.error);
