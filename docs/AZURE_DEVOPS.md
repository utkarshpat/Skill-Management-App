# Skill Genie Azure DevOps

The Azure Repos repository is `soprasteria / Skill Management App / Skill Management App`. The root `azure-pipelines.yml` validates pull requests through an Azure Repos build-validation policy and runs CI on `main` pushes. Set up the pipeline from **Azure Repos Git** and select **Existing Azure Pipelines YAML file** with `/azure-pipelines.yml`. Link it to the `main` build-validation policy to require checks on pull requests.

Successful `main` builds publish the `skill-genie-release` artifact with the App Service ZIP and ordered SQL migration ZIP. Apply the required migrations to the target database before deploying the corresponding app ZIP. The CI pipeline builds packages for release. The deployment target and Azure service connection are configured separately.

The browser checks include same-account recovery of an unsent draft on desktop and mobile. The isolated SQL fixtures in `database/tests` verify issuer-scoped Excel exports, combined queue pagination and filters, stale response edits, and conflicting certification imports. Run those fixtures only on the isolated audit database.
