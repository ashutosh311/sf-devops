# <PROJECT-NAME>

> This repository hosts the <PROJECT-NAME> Salesforce project.
>
> For more information, contact <devops-lead contact email>

## Table of Contents

[TOC]

## How do I get set up?

### Summary of set up

To get set up developing on this repository, you'll need to get a SSH key generated and added to your account. This is explained in detail below. These steps only typically apply to setting up for the first time, but there may be instances where these steps need to be followed again, such as a change of development machine.

### Generate an SSH key
* Prior to generating an SSH key, you need to install Git - 'https://git-scm.com/downloads'
* To check whether you have an SSH key pair available, run the following command in your terminal (Bash Terminal in Visual Studio Code) `cat ~/.ssh/id_rsa.pub`. If this returns a long combination of characters and symbols, select the output, copy to your clipboard, then skip to the last step below.
* To generate a public/private key pair, open up your Terminal (Terminal in Visual Studio Code) / Command Prompt (Windows) and run: `ssh-keygen`.
* Accept the default directory.
* Setting a password is optional, however will result in needing to enter it regularly. Hit enter to skip if you do not wish to set a password.
* Run the following command to output the public key to the terminal, then select the output and copy it to the clipboard: `cat ~/.ssh/id_rsa.pub`.
* In Bitbucket, click your Avatar and select __Personal settings__. In the left navigation, click __SSH keys__, then select the __Add key__ button. Provide a name (perhaps a reference to which laptop you're using), paste the previously copied content of your id_rsa.pub file, then select the __Add key__ button.

### Clone the repository

Clone this repository as follows:

* On the repository overview page, select the blue **Clone** button
* Ensure **SSH** is selected in the top right of the modal which appears, and copy the `git clone...` text
* Back in your terminal (Terminal in Visual Studio Code) , navigate to the desired location for your project, paste the 'git clone' command from the last step and hit **Enter**

The output will be similar to the following. Be sure to accept establishing trust to the server where this repository is located:

```
Cloning into <PROJECT-NAME>...
```

### Authenticate DEV Org with SF CLI

To communicate with the Salesforce environments you're building in, you'll need to authenticate SFDX with the DEV sandbox.

* Open your terminal in VS Code and execute the following:  
   `sfdx sf org login web -a dev -s -r https://<CLIENT-NAME>--dev.sandbox.my.salesforce.com`
* You should be navigated to your web browser, follow the prompt to login to Salesforce
* Return back to VS Code and you should see an output much like: `Successfully authorized name@domain.com with org ID xxxxxxxxxxxxx`

## Developer Workflow

To begin working on a story:

* Assign the Jira ticket to yourself and update to the relevant status
* Use the **Create branch** button on the ticket to create a branch in Bitbucket
   * Base branch: `develop`
   * Branch name: `feature/jiraId-jiraName`
* In VS Code, checkout your new feature branch by clicking the git branch button on the bottom left, then selecting your branch from the list (note: you can type your Jira number to search)
   * If you do not see your branch in the list, select the **Synchronize Changes** icon (just to the right of the last button) to fetch the latest changes from Bitbucket; then retry

Whilst you're building Salesforce related configurations:

* Keep a change log locally to record which components you will need to retrieve
* When you are ready, retrieve your changes using either of the following:
   * In VS Code's left navigation, the Salesforce icon will open the **Org Browser**. Simply ensure you are connected to the correct sandbox, navigate to the metadata type you want, find the component name and click the icon with an arrow inside a cloud to retrieve. Or,
   * Use the Salesforce CLI Retrieve commands, e.g. `sf project retrieve start -m "StandardValueSet:TaskStatus, CustomObject:Case"`. For full reference: https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_force_source.htm#cli_reference_force_source_retrieve

### Retrieving the latest changes into your branch

* When your feature branch is a few commits behind the base branch: 'develop', you have the ability to retrieve the latest changes onto your branch via Visual Studio Code:
   * Ensure your feature branch is checked out
   * Open your Command Palette with 'Command/Control + Shift + P' and enter 'Git: Pull From'
   * Select 'origin' then 'origin/develop' as the branch you want to retrieve your latest changes from
   * You can view all latest changes added to your branch from the 'Source Control' tab.
      * If another developer has amended a file you've worked on in your current feature branch, it  will appear under 'Merged Changes'. You'll need to ensure all your changes are present in this file alongside any other developers changes.

## Contribution guidelines

For more information on contributing to this project, please review the <CLIENT-NAME> Salesforce Developer Standards.