const { Octokit }  = require('@octokit/rest');
const fs = require('fs');
const csv = require('csv-parser');

const GH_PAT_SOURCE = process.env.GH_PAT_SOURCE;

const sourceRepo = { owner: 'liatrio-enterprise', repo: 'environment-migration-test' };
const targetRepo = { owner: 'liatrio-enterprise', repo: 'calvin-test' };

const octokitSource = new Octokit({
  auth: GH_PAT_SOURCE,
});

async function migrateEnvironments() {
  const {data: environments} = await octokitSource.repos.getAllEnvironments(sourceRepo)
  console.log("Environments: ", environments)

  let userMap = new Map()
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
    console.log("envList");
    console.log(envList);

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
