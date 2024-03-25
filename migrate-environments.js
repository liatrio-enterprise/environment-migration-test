const { Octokit } = require("@octokit/rest");
const sodium = require('libsodium-wrappers');
const core = require('@actions/core');

const octokit = new Octokit({
  auth: process.env.GH_PAT,
});

const secretValue = 'BRUH';

let newEnvs = [];

migrateEnvironments().catch(console.error);

////////// functions //////////

async function migrateEnvironments() {
    const sourceRepo = { owner: 'liatrio-enterprise', repo: 'environment-migration-test' };
    const targetRepo = { owner: 'liatrio-enterprise', repo: 'calvin-test' };
  
    // Get Deployment Environments from Source Repo
    const { data: environments } = await octokit.rest.repos.getAllEnvironments(sourceRepo);
  
    // Create Deployment Environments in Target Repo
    // for (const env of environments.environments) {
    //   await octokit.rest.repos.createOrUpdateEnvironment({
    //     owner: targetRepo.owner,
    //     repo: targetRepo.repo,
    //     environment_name: env.name,
    //     deployment_branch_policy: env.deployment_branch_policy,
    //     // wait_timer: env.wait_timer,
    //   });
    // }

    for (const env of environments.environments) {
        let wait_timer;
        if (env.protection_rules) {
          console.log(env.protection_rules);
          env.protection_rules.forEach((rule) => {
            if (rule.type === 'wait_timer') {
              wait_timer = rule.wait_timer;
            } else if (rule.type === 'required_reviewers'){
              console.log(rule.reviewers);
            }
          });
        }
        env.wait_timer = wait_timer;

        const protected_branches = env.deployment_branch_policy ? env.deployment_branch_policy.protected_branches : null;
        const custom_branch_policies = env.deployment_branch_policy ? env.deployment_branch_policy.custom_branch_policies : null;

        await octokit.rest.repos.createOrUpdateEnvironment({
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

    console.log("Environments: " + JSON.stringify(environments));
  
    // Gather Environment Secrets
    const secrets = await gatherEnvironmentSecrets(sourceRepo, environments);
    console.log("Secrets: " + JSON.stringify(secrets));

    const secrets2 = await processEnvs(secrets, secretValue);
    console.log("Secrets2: " + JSON.stringify(secrets2));
  
    // Migrate Environment Secrets
    await migrateEnvironmentSecrets(targetRepo, secrets2);
  
    // Gather Environment Variables
    const variables = await gatherEnvironmentVariables(sourceRepo, environments);
  
    // Migrate Environment Variables
    await migrateEnvironmentVariables(targetRepo, variables);

    // Created Issues for migrated secrets
    await generateIssuesForEnvironments(secrets);
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
        console.log("Key: " + key);

        envObj.encrypted = await encryptSecrets(key, secret);
        newEnvs.push(envObj);
    }

    // Show results
    console.log("Showing Results");
    console.log(newEnvs);
    // core.setOutput('encrypted_output', newEnvs);
    return newEnvs;
}

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
        console.log("Generated encrypted value:" + output);
        return output;
    });
    return result;
}

async function gatherEnvironmentSecrets(repo, environments) {
    const response = environments;
    let envs = [];

    for (const env of response.environments) {
      let envObj = {
        name: env.name,
        secrets: [],
        key_id: '',
        key: '',
      };

      const repoID = await octokit.rest.repos.get({
        owner: repo.owner,
        repo: repo.repo,
      });

      console.log(repoID.data.id);

      const secretsResponse = await octokit.rest.actions.listEnvironmentSecrets({
        repository_id: repoID.data.id,
        environment_name: env.name
      });

      const keyResponse = await octokit.rest.actions.getEnvironmentPublicKey({
        repository_id: repoID.data.id,
        environment_name: env.name,
      });

      envObj.key_id = keyResponse.data.key_id;
      envObj.key = keyResponse.data.key;

      console.log(JSON.stringify(secretsResponse));
      console.log(secretsResponse.data.secrets);
      console.log(keyResponse.data);

      for (const secret of secretsResponse.data.secrets) {

        console.log(secret.name);
        // Get the value of the secret
        const secretValue = await octokit.rest.actions.getEnvironmentSecret({
          repository_id: repoID.data.id,
          environment_name: env.name,
          secret_name: secret.name,
        });

        envObj.secrets.push({
          name: secret.name,
          value: secretValue.data
        });

        console.log(secretValue.data);

        envs.push(envObj);

      }
    }

    console.log(JSON.stringify(envs));
    return envs;
}

async function migrateEnvironmentSecrets(repo, secrets) {
    const envs = secrets;
    console.log(JSON.stringify(envs));

    const repoID = await octokit.rest.repos.get({
        owner: repo.owner,
        repo: repo.repo,
    });

    for (const env of envs) {

        for (const sec of env.secrets){
        // Migrate the secret to the target repository
        const secretResponse = await octokit.rest.actions.createOrUpdateEnvironmentSecret({
            repository_id: repoID.data.id,
            environment_name: env.name,
            secret_name: sec.name,
            encrypted_value: env.encrypted,
            key_id: env.key_id,
        });

        console.log(secretResponse.data);
        }
    }
}

async function gatherEnvironmentVariables(repo, environments) {
    const response = environments;
    let envs = [];

    for (const env of response.environments) {
      let envObj = {
        name: env.name,
        vars: []
      };

      const repoID = await octokit.rest.repos.get({
        owner: repo.owner,
        repo: repo.repo,
      });

      console.log(repoID.data.id);

      const variablesResponse = await octokit.rest.actions.listEnvironmentVariables({
        repository_id: repoID.data.id,
        environment_name: env.name,
      });

      console.log(JSON.stringify(variablesResponse));
      console.log(variablesResponse.data.variables);

      for (const variable of variablesResponse.data.variables) {

        console.log(variable.name);

        envObj.vars.push({
          name: variable.name,
          value: variable.value
        });

        envs.push(envObj);

      }
    }

    console.log(JSON.stringify(envs));
    return envs;
}

async function migrateEnvironmentVariables(repo, variables) {
    const envs = variables;
    console.log(JSON.stringify(envs));

    for (const env of envs) {
      const repoID = await octokit.rest.repos.get({
        owner: repo.owner,
        repo: repo.repo,
      });

      for (const variable of env.vars){
        // Migrate the variable to the target repository
        const variableResponse = await octokit.rest.actions.createEnvironmentVariable({
          repository_id: repoID.data.id,
          environment_name: env.name,
          name: variable.name,
          value: variable.value,
        });

        console.log(variableResponse.data);
      }
    }
}

async function generateIssuesForEnvironments(envs) {
    for (const env of envs) {
      let issueBody = `Please update the following secrets for the ${env.name} environment:\n`;
  
      for (const sec of env.secrets) {
        issueBody += `- [ ] ${sec.name}\n`;
      }
  
      issueBody += `\n\nOnce the secrets have been updated, please close this issue.`;
  
      const issueResult = await octokit.rest.issues.create({
        owner: 'liatrio-enterprise',
        repo: 'calvin-test',
        title: 'Update secrets for environment: ' + env.name,
        body: issueBody,
      });
  
      console.log(issueResult.data);
    }
}
