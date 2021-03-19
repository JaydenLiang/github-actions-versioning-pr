import * as core from '@actions/core';
import * as github from '@actions/github';

try {
    const versionType = core.getInput('version-type');
    const prerelease = core.getInput('prerelease');
    const preId = core.getInput('pre-id');
    const prBaseBranch = core.getInput('pr-base-branch');
    const prTemplate = core.getInput('pr-template');
    // const prIncomingBranch = core.getInput('pr-base-branch');
    const prTitle = core.getInput('pr-title');
    const prBody = core.getInput('pr-body');
    const prReviewers = core.getInput('pr-reviewers');
    const prTeamReviewers = core.getInput('pr-team-reviewers');
    const prLabels = core.getInput('pr-labels');
    const prUpdateIfExist = core.getInput('pr-update-if-exist');
    // const repo = ``;
    // let basePackageJson: { [key: string]: unknown };
    // console.log(`Fetching package.json from repo: ${}`)
    const time = (new Date()).toTimeString();
    console.log('time:', time);
    console.log('input value for version-type:', versionType);
    console.log('input value for prerelease:', prerelease);
    console.log('input value for preId:', preId);
    console.log('input value for prBaseBranch:', prBaseBranch);
    console.log('input value for prTemplate:', prTemplate);
    console.log('input value for prTitle:', prTitle);
    console.log('input value for prBody:', prBody);
    console.log('input value for prReviewers:', prReviewers);
    console.log('input value for prTeamReviewers:', prTeamReviewers);
    console.log('input value for prLabels:', prLabels);
    console.log('input value for prUpdateIfExist:', prUpdateIfExist);
    core.setOutput('base-branch', prBaseBranch);
    core.setOutput('incoming-branch', 'not-set-yet');
    core.setOutput('old-version', 'not-set-yet');
    core.setOutput('new-version', 'not-set-yet');
    core.setOutput('new-tag', 'not-set-yet');
    core.setOutput('versioning-cmd', 'not-set-yet');
    // Get the JSON webhook payload for the event that triggered the workflow
    const payload = JSON.stringify(github.context.payload, null, 4);
    console.log('payload:', payload);
} catch (error) {
    core.setFailed((error as Error).message);
}
