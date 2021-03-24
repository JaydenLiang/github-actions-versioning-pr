import * as core from '@actions/core';
import * as github from '@actions/github';
import axios, { AxiosRequestConfig } from 'axios';
import StatusCodes from 'http-status-codes';
import path from 'path';
import yaml from 'yaml';

interface PrTemplate {
    "pull-request": {
        title: string;
        description?: string;
        assignees?: string[];
        reviewers?: string[];
        'team-reviewers'?: string[];
        labels?: string[];
    };
    "info-comment"?: {
        body: string;
    }
    [key: string]: unknown;
}


async function fetchPackageJson(owner: string, repo: string, branch: string): Promise<{ [key: string]: unknown }> {
    const basePackageJsonUrl = `https://raw.githubusercontent.com/` +
        `${owner}/${repo}/${branch}/package.json`;

    const options: AxiosRequestConfig = {
        method: 'GET',
        headers: {
            Accept: 'application/json'
        },
        url: basePackageJsonUrl,
        timeout: 30000
    };
    const response = await axios(options);
    return response.data;
}

async function loadTemplate<T>(owner: string, repo: string, branch: string, filePath: string): Promise<T> {
    let normalizedPath = path.normalize(filePath);
    const url = `https://raw.githubusercontent.com/` +
        `${owner}/${repo}/${branch}${normalizedPath.startsWith('/') ? '' : '/'}${filePath}`;

    const options: AxiosRequestConfig = {
        method: 'GET',
        headers: {
            Accept: 'text/plain'
        },
        url: url,
        timeout: 30000
    };
    const response = await axios(options);
    return yaml.parse(response.data) as T;
}

function initOctokit() {
    // usage example from: https://github.com/actions/toolkit/tree/main/packages/github
    // This should be a token with access to your repository scoped in as a secret.
    // The YML workflow will need to set myToken with the GitHub Secret Token
    // myToken: ${{ secrets.GITHUB_TOKEN }}
    // https://help.github.com/en/actions/automating-your-workflow-with-github-actions/authenticating-with-the-github_token#about-the-github_token-secret
    const token = core.getInput('github-token');
    const octokit = github.getOctokit(token);
    return octokit;
}

async function main(): Promise<void> {
    try {
        const octokit = initOctokit();
        const [owner, repo] = github.context.payload.repository.full_name.split('/');
        const baseBranch = core.getInput('base-branch') || '';
        const headBranch = core.getInput('head-branch') || '';
        const defaultBranch = String(github.context.payload.repository.default_branch) || 'main';
        const isPrerelease = core.getInput('prerelease') || '';
        const prCreateDraft = core.getInput('pr-create-draft') || '';
        const prFailIfExist = core.getInput('pr-fail-if-exist') || '';
        let prTemplateUri = core.getInput('pr-template-uri') || '';

        let prTitle: string = core.getInput('pr-title') || '';
        let prDescription: string = core.getInput('pr-description') || '';

        const inputPrAssignees = core.getInput('pr-assignees') || '';
        const inputPrReviewers = core.getInput('pr-reviewers') || '';
        const inputPrTeamReviewers = core.getInput('pr-team-reviewers') || '';
        const inputPrLabels = core.getInput('pr-labels') || '';
        let prAssignees = inputPrAssignees.split(',').filter(n => !!n) || [];
        let prReviewers = inputPrReviewers.split(',').filter(n => !!n) || [];
        let prTeamReviewers = inputPrTeamReviewers.split(',').filter(n => !!n) || [];
        let prLabels = inputPrLabels.split(',').filter(n => !!n) || [];

        // fetch the old version
        console.log(`Fetching package.json from: ${owner}/${repo}/${baseBranch}`);
        const basePackageJson: { [key: string]: unknown } = await fetchPackageJson(owner, repo, baseBranch);
        const baseVersion = basePackageJson.version as string;
        // fetch the new version
        console.log(`Fetching package.json from: ${owner}/${repo}/${headBranch}`);
        const headPackageJson: { [key: string]: unknown } = await fetchPackageJson(owner, repo, headBranch);
        const headVersion = headPackageJson.version as string;
        // fetch pr-template yaml
        // NOTE: if a custom location is specified, use the custom location
        // otherwise, use the common template located in .github/workflows/templates/versioning-pr.yml
        // of the default branch of the repo where the action is hosted.
        // CAUTION: even though using the custom location, the location is still retricted to
        // a relative path to the default branch of the repo where the action is hosted.
        if (!prTemplateUri) {
            prTemplateUri = '.github/workflows/templates/versioning-pr.yml';
        }
        console.log('prTemplateUri:', prTemplateUri);
        const templateYaml = await loadTemplate<PrTemplate>(owner, repo, defaultBranch, prTemplateUri);
        const prTemplateNode = templateYaml['pull-request'];
        prTitle = prTitle || (prTemplateNode.title);
        prDescription = prDescription || prTemplateNode.description;
        if (prReviewers.length === 0 && prTemplateNode.reviewers) {
            prReviewers = prTemplateNode.reviewers;
        }
        if (prTeamReviewers.length === 0
            && prTemplateNode['team-reviewers']) {
            prTeamReviewers = prTemplateNode['team-reviewers'];
        }
        if (prLabels.length === 0 && prTemplateNode.labels) {
            prLabels = prTemplateNode.labels;
        }
        console.log('prAssignees:', prAssignees);
        console.log('prReviewers:', prReviewers);
        console.log('prTeamReviewers:', prTeamReviewers);
        console.log('prLabels:', prLabels);
        // replace place holders in template
        const replace = (str: string): string => {
            return str
                .replace(new RegExp('\\${base-branch}', 'g'), baseBranch)
                .replace(new RegExp('\\${base-version}', 'g'), baseVersion)
                .replace(new RegExp('\\${head-branch}', 'g'), headBranch)
                .replace(new RegExp('\\${head-version}', 'g'), headVersion)
                .replace(new RegExp('\\${is-prerelease}', 'g'), isPrerelease);
        };
        prTitle = replace(prTitle);
        prDescription = replace(prDescription);
        core.setOutput('base-branch', baseBranch);
        core.setOutput('base-version', baseVersion);
        core.setOutput('head-branch', baseBranch);
        core.setOutput('head-version', baseVersion);
        core.setOutput('is-prerelease', isPrerelease);
        core.setOutput('is-draft-pr', prCreateDraft);

        // get the pr with the same head and base
        const prListResponse = await octokit.pulls.list({
            owner: owner,
            repo: repo,
            head: headBranch,
            base: baseBranch,
            sort: 'updated', // will sort all pr by updated time
            direction: 'desc', // will sort with latest ones on top
        });

        // ASSERT: the 1st pr is the latest updated one (either open or closed)
        let pullRequest = prListResponse.data.length && prListResponse.data[0];

        // additional checking if need to check fail-if-exist
        console.log('Action [pr-fail-if-exist] is set: ' +
            `${prFailIfExist === 'true' && 'true' || 'false'}`);
        if (prFailIfExist === 'true' && pullRequest && pullRequest.state === 'open') {
            throw new Error(
                `Not allowed to re-issue a pull request to base branch: ${baseBranch}` +
                ` from head branch: ${headBranch}. An open pull request is found.`);
        }
        // if an open pr is found, update it. otherwise, create one
        if (pullRequest) {
            const prUpdateResponse = await octokit.pulls.update({
                owner: owner,
                repo: repo,
                pull_number: pullRequest.number,
                title: prTitle || undefined,
                body: prDescription || undefined,
                state: 'open', // reopen if prviously closed.
            });
            pullRequest = prUpdateResponse.data;
        }
        // create a pr with the above title and description.
        else {
            const prCreateResponse = await octokit.pulls.create({
                owner: owner,
                repo: repo,
                head: headBranch,
                base: baseBranch,
                title: prTitle || undefined,
                body: prDescription || undefined,
                draft: prCreateDraft === 'true'
            });
            pullRequest = prCreateResponse.data;
        }
        core.setOutput('pull-request-number', pullRequest.number);
        core.setOutput('pull-request-url', pullRequest.url);

        // add or update a review comment to store useful transitional informations.
        const commentHashTag = '#info-comment';
        const infoCommentTemplate = templateYaml['info-comment'];
        const infoCommentBody = infoCommentTemplate
            && infoCommentTemplate.body
            && replace(infoCommentTemplate.body) || '';
        // get comments and filter by github bot author:
        // login: github-actions[bot]
        // id: 41898282
        const prListCommentResponse = await octokit.issues.listComments({
            owner: owner,
            repo: repo,
            issue_number: pullRequest.number
        });
        const [infoComment] = prListCommentResponse.data.filter(comment => {
            return comment.body_text.startsWith(commentHashTag)
                && (comment.user.login === 'github-actions[bot]' || comment.user.id === 41898282);
        });

        // info comment is found, update it.
        if (infoComment) {
            await octokit.issues.updateComment({
                owner: owner,
                repo: repo,
                comment_id: infoComment.id,
                body: `${commentHashTag} ${infoCommentBody}`
            });
        }
        // otherwise, add a comment
        else {
            await octokit.issues.createComment({
                owner: owner,
                repo: repo,
                issue_number: pullRequest.number,
                body: `${commentHashTag} ${infoCommentBody}`
            });
        }
        // add assignee if needed
        const assignees: string[] = [];
        if (prAssignees.length) {
            // check if a user can be assigned, filter non-assignable users
            // see: https://octokit.github.io/rest.js/v18#issues-check-user-can-be-assigned
            await Promise.allSettled(
                prAssignees.map(async (assignee) => {
                    let neg = 'not ';
                    console.log(`Checking before adding assignee: ${assignee}...`);
                    const res = await octokit.issues.checkUserCanBeAssigned({
                        owner: owner,
                        repo: repo,
                        assignee: assignee
                    });
                    if (res.status === StatusCodes.NO_CONTENT) {
                        assignees.push(assignee);
                        neg = '';
                    }
                    console.log(`assignee: ${assignee} is ${neg}assignable.`);
                }
                ));
            if (assignees.length) {
                await octokit.issues.addAssignees({
                    owner: owner,
                    repo: repo,
                    issue_number: pullRequest.number,
                    assignees: prAssignees
                });
            }
        }
        // output the actual assignees.
        core.setOutput('assignees', assignees.length && assignees.join(',') || '');

        // add reviewers if needed
        if (prReviewers.length || prTeamReviewers.length) {
            await octokit.pulls.requestReviewers({
                owner: owner,
                repo: repo,
                pull_number: pullRequest.number,
                reviewers: prReviewers,
                team_reviewers: prTeamReviewers
            });
        }
        // output the actual reviewers and / or team reviewers.
        core.setOutput('reviewers', prReviewers.length && prReviewers.join(',') || '');
        core.setOutput('team-reviewers', prTeamReviewers.length && prTeamReviewers.join(',') || '');

        // add labels if needed
        if (prLabels.length) {
            await octokit.issues.addLabels({
                owner: owner,
                repo: repo,
                issue_number: pullRequest.number,
                labels: prLabels
            });
        }
        // output the actual lables.
        core.setOutput('labels', prLabels.length && prLabels.join(',') || '');

        // Get the JSON webhook payload for the event that triggered the workflow
        const payload = JSON.stringify(github.context.payload, null, 4);
        console.log('payload:', payload);
    } catch (error) {
        core.setFailed((error as Error).message);
    }
}

main();
