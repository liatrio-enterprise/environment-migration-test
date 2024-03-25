const { Octokit }  = require('@octokit/rest');
const fs = require('fs');
const csv = require('csv-parser');

const sourceRepo = { owner: 'liatrio-enterprise', repo: 'environment-migration-test' };
const targetRepo = { owner: 'liatrio-enterprise', repo: 'calvin-test' };

const octokitSource = new Octokit({
  auth: process.env.GH_PAT_SOURCE,
});

const octokitTarget = new Octokit({
  auth: process.env.GH_PAT_TARGET,
});

async function migrateEnvironments() {
  const {data: environments} = await octokitSource.repos.getAllEnvironments(sourceRepo)
  console.log("Environments: ", environments)

  let usersMap = new Map()
  try {
    usersMap = await generateUserMap()
    console.log("generate user map: ")
    console.log(usersMap)
  } catch(error) {
    console.error(error)
  }

  let reviewerList = []
  let envList = []

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

  generateIssuesForRequiredReviewers(targetRepo, envList)
  console.log("envList");
  console.log(envList);
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

async function generateIssuesForRequiredReviewers(repo, envList) {
  let reviewers = false

  for (const env of envList) {
    let issueBody = `Please update the following reviewers for the \`${env.env}\` environment:\n`

    for (const reviewer of env.reviewerList) {
      issueBody += `- [ ] \`${reviewer}\`\n`;
      reviewers = true;
    }

    issueBody += `\nProtection Rule \`prevent_self_review\` is set to \`${env.prevent_self_review}\`, Please set accordingly in Protection Rules.\n`;
    issueBody += `\n\nPlease update the reviewers for the \`${env.env}\` environment by adding the correct users as reviewers. If you are unsure who to add, please reach out to the team for guidance.`;
    issueBody += `\n\nOnce the reviewers have been updated, please close this issue.`;

    if (reviewers) {
      const issueResult = await octokitTarget.rest.issues.create({
          owner: repo.owner,
          repo: repo.repo,
          title: 'Update reviewers for environment: ' + `\`${env.env}\``,
          body: issueBody,
      });
      console.log(issueResult.data);
    }
  }
}

migrateEnvironments().catch(console.error);
