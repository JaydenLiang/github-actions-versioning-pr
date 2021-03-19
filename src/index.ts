import * as core from '@actions/core';
import * as github from '@actions/github';

try {
    const versionType = core.getInput('version-type');
    console.log('input value for version-type:', versionType);
    const time = (new Date()).toTimeString();
    console.log('time:', time);
    core.setOutput('version-type', versionType);
    // Get the JSON webhook payload for the event that triggered the workflow
    const payload = JSON.stringify(github.context.payload, null, 4);
    console.log('payload:', payload);
} catch (error) {
    core.setFailed((error as Error).message);
}
