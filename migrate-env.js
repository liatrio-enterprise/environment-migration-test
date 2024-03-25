const { Octokit } = require("@octokit/rest");
const fs = require('fs');
const csv = require('csv-parser');
// const sodium = require('libsodium-wrappers');

const GH_PAT_SOURCE = process.env.GH_PAT_SOURCE;
// const GH_PAT_TARGET = process.env.GH_PAT_TARGET;

// const sourceRepo = { owner: process.env.GH_SOURCE_ORG, repo: process.env.GH_SOURCE_REPO };
// const targetRepo = { owner: process.env.GH_TARGET_ORG, repo: process.env.GH_TARGET_REPO };
const sourceRepo = { owner: 'liatrio-enterprise', repo: 'environment-migration-test' };
const targetRepo = { owner: 'liatrio-enterprise', repo: 'calvin-test' };

const octokitSource = new Octokit({
  auth: GH_PAT_SOURCE,
});

// const octokitTarget = new Octokit({
//     auth: GH_PAT_TARGET,
// });

// const secretValue = 'tempSecret';

// let newEnvs = [];

// console.log('\n');
// console.log("Starting Environment Migration...");

async function migrateEnvironments() {
    // Get Deployment Environments from Source Repo
    const { data: environments } = await octokitSource.rest.repos.getAllEnvironments(sourceRepo);
    console.log("Environments: " + JSON.stringify(environments));

    let usersMap = new Map();​
    try {
        usersMap = await generateUserMap();
        console.log("generateUserMap return value");
        console.log(usersMap);
    } catch (error) {
        console.error(error);
    }
    
    let reviewerList = [];
    let envList = [];

    for (const env of environments.environments) {
        let wait_timer;
        let envObj = { 
            env: env.name,
            reviewerList: reviewerList,
            prevent_self_review: false,
        };
        if (env.protection_rules) {
          console.log(env.protection_rules);
          env.protection_rules.forEach((rule) => {
            if (rule.type === 'wait_timer') {
              wait_timer = rule.wait_timer;
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
              envList.push(envObj);
            }
          });
        }
        env.wait_timer = wait_timer;
        //console.log("envList");
        //console.log(envList);

        const protected_branches = env.deployment_branch_policy ? env.deployment_branch_policy.protected_branches : null;
        const custom_branch_policies = env.deployment_branch_policy ? env.deployment_branch_policy.custom_branch_policies : null;

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

    //console.log("Environments: " + JSON.stringify(environments));
    //console.log("envList outside of loop");
    //console.log(envList);

    // // Created Issues for migrated reviewers
    // await generateIssuesForEnvironmentsReviewers(targetRepo, envList);
    // // process.exit(0);
  
    // // Gather Environment Secrets
    // const secrets = await gatherEnvironmentSecrets(sourceRepo, environments);
    // //console.log("Secrets: " + JSON.stringify(secrets));

    // const secretsEncrypt = await processEnvs(secrets, secretValue);
    // //console.log("Secrets2: " + JSON.stringify(secrets2));
  
    // // Migrate Environment Secrets
    // await migrateEnvironmentSecrets(targetRepo, secretsEncrypt);
  
    // // Gather Environment Variables
    // const variables = await gatherEnvironmentVariables(sourceRepo, environments);
  
    // // Migrate Environment Variables
    // await migrateEnvironmentVariables(targetRepo, variables);

    // // Created Issues for migrated secrets
    // await generateIssuesForEnvironmentsSecrets(targetRepo, secrets);

    // console.log("Environment Migration Complete");
    // console.log('\n');
}

async function processEnvs(envs, secret) {
    for (const env of envs) {
        let envObj = {
            name: env.name,
            secrets: env.secrets,
            key_id: env.key_id,
            key: env.key,
            encrypted: '',
        };
        const key = env.key;
        //console.log("Key: " + key);
​
        envObj.encrypted = await encryptSecrets(key, secret);
        newEnvs.push(envObj);
    }
​
    // Show results
    //console.log("Showing Results");
    //console.log(newEnvs);
    //core.setOutput('encrypted_output', newEnvs);
    return newEnvs;
}
​
async function encryptSecrets(key, secret){
    const result = await sodium.ready.then(() => {
        // Convert the secret and key to a Uint8Array.
        let binkey = sodium.from_base64(key, sodium.base64_variants.ORIGINAL);
        let binsec = sodium.from_string(secret);
    
        // Encrypt the secret using libsodium
        let encBytes = sodium.crypto_box_seal(binsec, binkey);
    
        // Convert the encrypted Uint8Array to Base64
        let output = sodium.to_base64(encBytes, sodium.base64_variants.ORIGINAL);
    
        // Print and save the output
        //console.log("Generated encrypted value:" + output);
        return output;
    });
    return result;
}
​
async function gatherEnvironmentSecrets(repo, environments) {
    const response = environments;
    let envs = [];
​
    for (const env of response.environments) {
      let envObj = {
        name: env.name,
        secrets: [],
        key_id: '',
        key: '',
      };
​
      const repoID = await octokitSource.rest.repos.get({
        owner: repo.owner,
        repo: repo.repo,
      });
​
      //console.log(repoID.data.id);
​
      const secretsResponse = await octokitSource.rest.actions.listEnvironmentSecrets({
        repository_id: repoID.data.id,
        environment_name: env.name
      });
​
      const keyResponse = await octokitSource.rest.actions.getEnvironmentPublicKey({
        repository_id: repoID.data.id,
        environment_name: env.name,
      });
​
      envObj.key_id = keyResponse.data.key_id;
      envObj.key = keyResponse.data.key;
​
      //console.log(JSON.stringify(secretsResponse));
      //console.log(secretsResponse.data.secrets);
      //console.log(keyResponse.data);
​
      for (const secret of secretsResponse.data.secrets) {
​
        //console.log(secret.name);
        // Get the value of the secret
        const secretValue = await octokitSource.rest.actions.getEnvironmentSecret({
          repository_id: repoID.data.id,
          environment_name: env.name,
          secret_name: secret.name,
        });
​
        envObj.secrets.push({
          name: secret.name,
          value: secretValue.data
        });
​
        //console.log(secretValue.data);
​
        envs.push(envObj);
​
      }
    }
​
    //console.log(JSON.stringify(envs));
    return envs;
}
​
async function migrateEnvironmentSecrets(repo, secrets) {
    const envs = secrets;
    //console.log(JSON.stringify(envs));
​
    const repoID = await octokitTarget.rest.repos.get({
        owner: repo.owner,
        repo: repo.repo,
    });
​
    for (const env of envs) {
​
        for (const sec of env.secrets){
        // Migrate the secret to the target repository
        const secretResponse = await octokitTarget.rest.actions.createOrUpdateEnvironmentSecret({
            repository_id: repoID.data.id,
            environment_name: env.name,
            secret_name: sec.name,
            encrypted_value: env.encrypted,
            key_id: env.key_id,
        });
​
        //console.log(secretResponse.data);
        }
    }
}
​
async function gatherEnvironmentVariables(repo, environments) {
    const response = environments;
    let envs = [];
​
    for (const env of response.environments) {
      let envObj = {
        name: env.name,
        vars: []
      };
​
      const repoID = await octokitSource.rest.repos.get({
        owner: repo.owner,
        repo: repo.repo,
      });
​
      //console.log(repoID.data.id);
​
      const variablesResponse = await octokitSource.rest.actions.listEnvironmentVariables({
        repository_id: repoID.data.id,
        environment_name: env.name,
      });
​
      //console.log(JSON.stringify(variablesResponse));
      //console.log(variablesResponse.data.variables);
​
      for (const variable of variablesResponse.data.variables) {
​
        //console.log(variable.name);
​
        envObj.vars.push({
          name: variable.name,
          value: variable.value
        });
​
        envs.push(envObj);
​
      }
    }
​
    //console.log(JSON.stringify(envs));
    return envs;
}
​
async function migrateEnvironmentVariables(repo, variables) {
    const envs = variables;
    //console.log(JSON.stringify(envs));
​
    for (const env of envs) {
      const repoID = await octokitTarget.rest.repos.get({
        owner: repo.owner,
        repo: repo.repo,
      });
​
      for (const variable of env.vars){
        // Migrate the variable to the target repository
        const variableResponse = await octokitTarget.rest.actions.createEnvironmentVariable({
          repository_id: repoID.data.id,
          environment_name: env.name,
          name: variable.name,
          value: variable.value,
        });
​
        //console.log(variableResponse.data);
      }
    }
}
​
async function generateIssuesForEnvironmentsSecrets(repo, envs) {
    for (const env of envs) {
      let issueBody = `Please update the following secrets for the \`${env.name}\` environment:\n`;
  
      for (const sec of env.secrets) {
        issueBody += `- [ ] ${sec.name}\n`;
      }
  
      issueBody += `\n\nOnce the secrets have been updated, please close this issue.`;
  
      const issueResult = await octokitTarget.rest.issues.create({
        owner: repo.owner,
        repo: repo.repo,
        title: 'Update secrets for environment: ' + `\`${env.name}\``,
        body: issueBody,
      });
  
      //console.log(issueResult.data);
    }
}
​
async function generateIssuesForEnvironmentsReviewers(repo, envList) {
    let reviewers = false; 
​
    for (const env of envList) {
        let issueBody = `Please update the following reviewers for the \`${env.env}\` environment:\n`;
​
        issueBody += `\n\nReviewers Handles:\n`;
    
        for (const reviewer of env.reviewerList) {
            issueBody += `- [ ] \`${reviewer}\`\n`;
            reviewers = true;
        }
​
        issueBody += `\nProtection Rule \`prevent_self_review\` is set to \`${env.prevent_self_review}\`, Please set accordingly in Protection Rules.\n`;
​
        issueBody += `\n\nPlease update the reviewers for the \`${env.env}\` environment by adding the correct users as reviewers. If you are unsure who to add, please reach out to the team for guidance.`;
    
        issueBody += `\n\nOnce the reviewers have been updated, please close this issue.`;
    
        if (reviewers) {
            const issueResult = await octokitTarget.rest.issues.create({
                owner: repo.owner,
                repo: repo.repo,
                title: 'Update reviewers for environment: ' + `\`${env.env}\``,
                body: issueBody,
            });
            //console.log(issueResult.data);
        }
      }
}

async function generateUserMap() {
    return new Promise((resolve, reject) => {
        const usersMap = new Map();
        fs.createReadStream('users.csv')
        .pipe(csv())
        .on('data', (row) => {
            usersMap.set(row['mannequin-user'], row['target-user']);
        })
        .on('end', () => {
            //console.log("generated usersMap");
            resolve(usersMap);
        })
        .on('error', (error) => {
            reject(error);
        });
    });
}

migrateEnvironments().catch(console.error);
