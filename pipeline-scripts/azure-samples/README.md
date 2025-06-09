# Azure DevOps (ADO) Conversion

> In this azure-samples directory, you'll find materials to support you in porting scripts over to ADO; since they are maintained to serve Bitbucket customers.  
> 
> The sample scripts are not continuously updated with the latest features found in utility and pipeline scripts. Instead, they have been copied from previous projects that have already undergone the porting exercise.
>
> The goal is to provide lessons learned regarding the differences between ADO and Bitbucket. You should still refer to the latest relevant Tier's pipeline script and utility versions (which will contain current designs), using this information as a guide for necessary changes.

## Key Differences & Considerations

### 1. Pipeline Architecture

    * **Bitbucket Pipelines:** Bitbucket Pipelines are built with a single .yml file at the root of a project. It provides three types of triggers you can build pipelines against: `branches:` (to execute a build when a commit is pushed to the specified branch), `pull-requests:` (to execute when a Pull Request is raised or changed, starting on that source branch) and `custom:` (builds that aren't triggered manually based on a change in the repo, and requires a push-to-start approach).
    
      In addition, the sample pipeline scripts utilise Bitbucket's feature of tracking deployments against environments (see https://support.atlassian.com/bitbucket-cloud/docs/set-up-and-monitor-deployments/), through the use of the `Deployment: UAT` syntax to associate a pipeline's run against a pre-configured environment in your landscape. More information on this topic can be found in the Miro board's section "Requirements Traceability" in the Model Feature Breakdown frame. A limitation of this feature means the Deployment value does not currently support parametrisation; otherwise it would be ideal to come from a variable selected at execution. Instead, you will notice distinct pipelines for validate and deploy jobs, for each Sandbox.  

    * **Azure DevOps Pipelines:** ADO is far more flexible, supports different types of pipeline scripts (including building through the UI). This flexibility comes at a cost, as the sheer amount of functions available means simple activities can look more confusing compared to simple CI/CD tools like Bitbucket.

      The most significant shift when building ADO pipelines is the benefit of splitting .yml files into separate files, based on the types of activities performed. While it's acceptable to have related jobs (e.g., data import and export tasks) in one pipeline script, controlling the two paths via parameters and conditions, the tasks involved in a delta Metadata deployment look quite different from data jobs, making it beneficial to separate them. The sample scripts can help suggest logical splits for .yml files. This can also be determined by examining the jobs against each trigger in the Bitbucket versions and grouping those that perform similar functions. For example, the release validate and deploy custom pipelines for each individual environment all effectively do the same thing, so it makes sense for them to be distinct .yml files and pipelines in ADO. 
      
      Rather than a single `azure-pipelines.yml` at the root of a project, consider a `pipelines/` directory, containing various .yml files, each defined with a meaningful name.

### 2. Pull Request Validation

    * **Bitbucket Pipelines:** As discussed above, Bitbucket supports a pipeline trigger called `pull-requests`, which allows for wildcards. For example, if your Branching Model dictates that `feature/` branches merge into `develop`, you can define a job like so:

      ```yml
      pipelines:
        pull-requests:
          feature/*:
      ```

      The key consideration is that the trigger is defined by the branch instigating the Pull Request, not the target branch. This is why our job checks the target branch via `- if [ $BITBUCKET_PR_DESTINATION_BRANCH != "develop" ]; then echo feature/ branches can only be merged into the develop branch; exit 1; fi`, to ensure Feature Pull Requests are raised correctly.

    * **Azure DevOps Pipelines:** ADO pipelines follow a similar `trigger:` convention when you define a CI-style job and prefer not to configure triggers via the UI (ADO supports both script-driven and UI configuration). While the trigger parameter also includes an option for Pull Requests, these do not achieve the same outcome as in Bitbucket.

      The concept of running a build on a Pull Request as a way to assert something (such as the Salesforce-specific example of validating a feature against a QA Sandbox), is achieved within Branch Policies (see https://learn.microsoft.com/en-us/azure/devops/repos/git/branch-policies?view=azure-devops&tabs=browser); more specifically through Build Validations in those Policies (https://learn.microsoft.com/en-us/azure/devops/repos/git/branch-policies?view=azure-devops&tabs=browser#build-validation). The linked documentation outlines the process, but in summary, your Pull Request-specific .yml files should state `trigger: none`. You should then "register" that Pipeline in the UI and set Build Validations against the branch where you want to implement a check before merges occur (e.g., develop)."

### 3. Authentication/Credentials Management

    * **Bitbucket Pipelines:** Has no facility to store files securely in a File Store. Instead you must encrypt JWT certificates to be committed to the repository, store decryption keys as secure text Pipeline Variables, and decrypt the certificate at runtime as part of pipeline scripts.

    * **Azure DevOps Pipelines:** Provides the ability to store files and access securely in pipelines (see https://learn.microsoft.com/en-us/azure/devops/pipelines/library/secure-files?view=azure-devops). Once a file has been stored, it can be retrieved via the Pipeline Task: DownloadSecureFile. See example below: 

        ```yml
        - task: DownloadSecureFile@1
          name: salesforceCertificate
          displayName: 'Download Server.key'
          inputs:
            secureFile: 'server.key'
        ```

        This removes the need to encrypt certificates (as described in the Miro board's DevOps Setup Guide). Similarly, the decryption process in `utilities/sf-authenticate.sh` is no longer needed. As a result, it may be simpler to bypass the script (rather than removing the decryption logic) and simply use a Pipeline Task for authentication:

        ```yml
        - script: sf login org jwt --client-id $(CONSUMER_KEY) --username $(USERNAME) -f $(salesforceCertificate.secureFilePath) --instance-url $(URL)
          displayName: 'SF Authenticate'
        ```

### 4. Variables and Parameterization

    * **Bitbucket Pipelines:** Uses a standard notation for accessing and setting variables `echo $BITBUCKET_BRANCH`, `export SF_USERNAME=bitbucket@abc.com.uat`, etc.

    * **Azure DevOps Pipelines:** Provides a richer set of predefined variables, grouped into categories (`$(Build.SourceBranch)`, `$(Build.Repository.Name)`). Project and repository level variables set in the UI can be similarly organised into groups. The syntax for working with variables in pipelines is a touch more involved (see https://learn.microsoft.com/en-us/azure/devops/pipelines/build/variables?view=azure-devops&tabs=yaml and https://learn.microsoft.com/en-us/azure/devops/pipelines/process/set-variables-scripts?view=azure-devops&tabs=bash). To access a custom group of variables, at the root of your pipeline script, use:

        ```yml
        variables:
        - group: Salesforce
        ```

        The syntax to use when accessing variables in scripts depends on how you want them compiled (see https://learn.microsoft.com/en-us/azure/devops/pipelines/process/variables?view=azure-devops&tabs=yaml%2Cbatch#understand-variable-syntax):

        ```yml
        variables:
        - name: one
          value: initialValue 

        steps:
          - script: |
            echo $(one) # will output "initialValue"

            # if the variable 'one' is updated during the build, using $(one) will output the new value 
            echo ${{ variables.one }} # will always output initialValue, regardless of whether it is changed during the pipeline run
        ```

        Setting variable in scripts follows the convention:

        ```yml
        - bash: |
          echo "##vso[task.setvariable variable=myVar;]foo"
        ```

        Ultimately, when porting scripts to an ADO project, you will need to pay particular attention to where pipelines and utility scripts are referencing and setting variables. The sample scripts in this directory demonstrate this activity; however, you should not rely solely on them as they are not actively maintained when new features are added to this accelerator.

### 5. Step/Task Conditions

    * **Bitbucket Pipelines:** Our sample Bitbucket scripts have a single Step for each pipeline, due to nuances regarding how variables set during a run remain available between Steps. As such, setting conditions to determine the behavior of a pipeline based on inputs is simple.

    * **Azure DevOps Pipelines:** ADO can operate similarly, for example, by writing an `if` statement when using the `- bash:` or `- script:` tasks. However, conditions can also be applied directly to tasks, which can help reduce logs by preventing tasks from being executed unnecessarily, only to be evaluated as not needed.

    ```yml
    - ${{ if eq(parameters.jobType, 'import') }}:
      - bash: |
          utilities/import-config-data.sh $(SF_USERNAME) ${{ parameters.dataPath }}
      displayName: Import Config Data

    - ${{ if eq(parameters.jobType, 'export') }}:
      - bash: |
          utilities/export-config-data.sh $(SF_USERNAME) ${{ parameters.dataPath }}
      displayName: Export Config Data
    ```

### 5. User Licenses

    * **Bitbucket Pipelines:** Bitbucket has several Product subscription tiers (Free, Basic, Premium), however, there are not differing License levels when provisioning users. Permissions are dictated through User Groups when providing access to a repository within a Workspace.

    * **Azure DevOps:** ADO has access levels associated to users (see https://learn.microsoft.com/en-us/azure/devops/organizations/security/access-levels?view=azure-devops). When creating users, you must review the access type assigned (Basic, Basic + Test Plans, Stakeholder, Visual Studio Subscriber). The documentation linked refers to what features each can use, however, be warned, some do not provide access to repositories (regardless of configuring Repository Settings which imply they do).

---

## Contributions

As explained above, the Azure sample scripts cannot be relied upon for completeness (i.e., they cannot simply be lifted-and-shifted and expected to align with the current published Silver/Gold/Platinum Tier design). They are provided for reference to illustrate how some of the translations discussed in the 'Key Differences & Considerations' section will be implemented.

That being said, these samples were contributed by someone porting this accelerator to Azure, and at that time, they likely reflected the current state of the designs. If your work to translate the accelerator's scripts for Azure compatibility includes something not found in the samples, and you believe future consultants facing a similar task might find it helpful, please consider raising a Pull Request to enrich the content in this azure-samples directory.
