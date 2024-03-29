# environment-migration-test

# Environment Migration Script User Guide

Required input:

* Source Repo Name
* Target Repo Name
* Source Repo Org Name
* Target Repo Org Name
* Personal Access Token For Source (repo, users, and org:admin)
* Personal Access Token For Target (repo, users, and org:admin)

The script will migrate the following settings:

* Secrets (name only, an issue will be opened to list secrets that need to be updated)
* Variables (ame and value)
* Protection rules (except reviewers, an issue will be opened listing reviewers by their login and will need to be added manually)
* Environment Name (optional repo ID tag at the end by changing a boolean in the code)

Script will migrate all environments from a source org to a target org and attempt to migrate most of the settings. Certain features were not
implemented since required reviewers may require org level permissions from a PAT (Personal Access Token) that we didn't have access to.

## Running in Github Actions

This option may be better since you can just save the action and script in a repo and it will run once a push is made

1. Ensure all Environment variables are set in the repo level secrets

The following secrets must be set in the repo:

* GH_PAT_SOURCE
* GH_PAT_TARGET

The following need to be environment variables:

* SOURCE_REPO
* TARGET_REPO
* SOURCE_ORG
* TARGET_ORG

2. Push changes to github

Once changes are pushed the scirpt will run and generate the issues that will alert repo owners that secrets and reviewers need to be updated.

## Running Locally

1. run `npm install`

This will ensure all node modules are installed for the `migrate.js` script

2. Save the required environment variables to your local environment

run `export $ENV_VAR_NAME=$value` for each of the following environment variables:

* SOURCE_REPO
* TARGET_REPO
* SOURCE_ORG
* TARGET_ORG
* GH_PAT_SOURCE
* GH_PAT_TARGET

Once this is done you can check the values were saved by running `echo $ENV_VAR_NAME`

3. run `node migrate.js`

This will run the script and do the migration from the terminal, if all goes well you should see `Migration Complete`
