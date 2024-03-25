const { Octokit }  = require('@octokit/rest')
const fs = require('fs')
const csv = require('csv-parser')
const sodium = require('libsodium-wrappers')

const sourceRepo = { owner: 'liatrio-enterprise', repo: 'environment-migration-test' }
const targetRepo = { owner: 'liatrio-enterprise', repo: 'calvin-test' }

const octokitSource = new Octokit({
  auth: process.env.GH_PAT_SOURCE,
});

const octokitTarget = new Octokit({
  auth: process.env.GH_PAT_TARGET,
});

const secretValue = "temp"
let newEnvs = []

async function migrateEnvironments() {
  const {data: environments} = await octokitSource.repos.getAllEnvironments(sourceRepo)
  console.log("Environments: ", environments)

  // let usersMap = new Map()
  // try {
  //   usersMap = await generateUserMap()
  //   console.log("generate user map: ")
  //   console.log(usersMap)
  // } catch(error) {
  //   console.error(error)
  // }

  let reviewerList = []
  let envList = []

  for (const env of environments.environments) {
    let wait_timer
    let envObj = { 
        env: env.name,
        reviewerList: reviewerList,
        prevent_self_review: false,
    };
    if (env.protection_rules) {
      console.log(env.protection_rules);
      env.protection_rules.forEach((rule) => {
        if (rule.type === 'wait_timer') {
          wait_timer = rule.wait_timer
        } else if (rule.type === 'required_reviewers'){
          //console.log(rule.reviewers);
          if (rule.prevent_self_review === true) {
            envObj.prevent_self_review = true;
          }
          for (const reviewer of rule.reviewers) {
            //console.log(reviewer.reviewer.login);
            reviewerList.push(reviewer.reviewer.login );
          }
          envObj.reviewerList = reviewerList;
          envList.push(envObj)
        }
      });
    }
    env.wait_timer = wait_timer

    const protected_branches = env.deployment_branch_policy ? env.deployment_branch_policy.protected_branches : null
    const custom_branch_policies = env.deployment_branch_policy ? env.deployment_branch_policy.custom_branch_policies : null

    await octokitSource.rest.repos.createOrUpdateEnvironment({
      owner: targetRepo.owner,
      repo: targetRepo.repo,
      environment_name: env.name,
      deployment_branch_policy: env.deployment_branch_policy ? {
        protected_branches: protected_branches,
        custom_branch_policies: custom_branch_policies,
      } : null,
      wait_timer: env.wait_timer,
    });
  }

  
  const secrets = await getEnvironmentSecrets(environments)
  const secretsEncrypt = await processEnvs(secrets, secretValue)
  await migrateSecrets(secretsEncrypt)
  
  // const variables = await getEnvironmentVariables(environments)
  // await migrateVariables(variables)
  
  await generateIssuesForRequiredReviewers(envList)
  await generateIssuesForEnvironmentSecrets(secrets)
}

// async function generateUserMap() {
//   return new Promise((resolve, reject) => {
//       const usersMap = new Map();
//       fs.createReadStream('users.csv')
//       .pipe(csv())
//       .on('data', (row) => {
//           usersMap.set(row['mannequin-user'], row['target-user']);
//       })
//       .on('end', () => {
//           //console.log("generated usersMap");
//           resolve(usersMap);
//       })
//       .on('error', (error) => {
//           reject(error);
//       });
//   });
// }

async function getEnvironmentSecrets(environments) {
  let envs = []

  for (const env of environments.environments ) {
    let envObj = {
      name: env.name,
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

async function generateIssuesForRequiredReviewers(envList) {
  let reviewers = false

  for (const env of envList) {
    let issueBody = `Please add the following reviewers for the \`${env.env}\` environment. Once the reviewers have been added, this issue can be closed.\n`

    for (const reviewer of env.reviewerList) {
      issueBody += `- [ ] \`${reviewer}\`\n`;
      reviewers = true;
    }

    if (reviewers) {
      const issueResult = await octokitTarget.rest.issues.create({
          owner: targetRepo.owner,
          repo: targetRepo.repo,
          title: 'Update reviewers for environment: ' + `\`${env.env}\``,
          body: issueBody,
      });
      console.log(issueResult.data);
    }
  }
}

migrateEnvironments().catch(console.error);
