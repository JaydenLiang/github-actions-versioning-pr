import * as core from '@actions/core';
import * as github from '@actions/github';
import axios, { AxiosRequestConfig } from 'axios';
import StatusCodes from 'http-status-codes';
import yaml from 'yaml';

interface PrTemplate {
    title: string;
    description?: string;
    preset?: {
        assignees?: string[];
        reviewers?: string[];
        'team-reviewers'?: string[];
        labels?: string[];
    }
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

async function loadPrTemplate(owner: string, repo: string, branch: string, filePath: string): Promise<PrTemplate> {
    const url = `https://raw.githubusercontent.com/` +
        `${owner}/${repo}/${branch}/${filePath}`;

    const options: AxiosRequestConfig = {
        method: 'GET',
        headers: {
            Accept: 'text/plain'
        },
        url: url,
        timeout: 30000
    };
    const response = await axios(options);
    return yaml.parse(response.data) as PrTemplate;
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
        const [, refType, refName] = /(?<=refs\/)([^\/]*)\/(\S*)/gm.exec(String(github.context.payload.ref)) || [];
        const isBranch = refType === 'heads';
        // const isTag = refType === 'tags';
        const mainBranch = github.context.payload.repository.default_branch || 'main';
        const baseBranch = core.getInput('base-branch') || '';
        const headBranch = isBranch && refName;
        const isPrerelease = core.getInput('is-prerelease') || '';
        const prCreateDraft = core.getInput('pr-create-draft') || '';
        const prFailIfExist = core.getInput('pr-fail-if-exist') || '';
        const prTemplateUri = core.getInput('pr-template-uri') || '';

        let prTitle: string = core.getInput('pr-title') || '';
        let prDescription: string = core.getInput('pr-description') || '';

        const inputPrAssignees = core.getInput('pr-assignees') || '';
        const inputPrReviewers = core.getInput('pr-reviewers') || '';
        const inputPrTeamReviewers = core.getInput('pr-team-reviewers') || '';
        const inputPrLabels = core.getInput('pr-labels') || '';
        let prAssignees = inputPrAssignees.split(',') || [];
        let prReviewers = inputPrReviewers.split(',') || [];
        let prTeamReviewers = inputPrTeamReviewers.split(',') || [];
        let prLabels = inputPrLabels.split(',') || [];

        // fetch the old version
        console.log(`Fetching package.json from: ${owner}/${repo}/${baseBranch}`);
        const basePackageJson: { [key: string]: unknown } = await fetchPackageJson(owner, repo, baseBranch);
        const baseVersion = basePackageJson.version as string;
        // fetch the new version
        console.log(`Fetching package.json from: ${owner}/${repo}/${headBranch}`);
        const headPackageJson: { [key: string]: unknown } = await fetchPackageJson(owner, repo, headBranch);
        const headVersion = headPackageJson.version as string;
        // fetch pr-template yaml if specified
        if (prTemplateUri) {
            console.log('prTemplateUri:', prTemplateUri);
            console.log('cwd', process.cwd());
            // NOTE: the template must reside in your GitHub repository, either in
            // the default branch or the head branch
            const templateYaml = await loadPrTemplate(owner, repo, mainBranch, prTemplateUri);
            prTitle = prTitle || (templateYaml.title);
            prDescription = prDescription || templateYaml.description;
            if (prReviewers.length === 0 && templateYaml.preset && templateYaml.preset.reviewers) {
                prReviewers = templateYaml.preset.reviewers;
            }
            if (prTeamReviewers.length === 0 && templateYaml.preset
                && templateYaml.preset['team-reviewers']) {
                prTeamReviewers = templateYaml.preset['team-reviewers'];
            }
            if (prLabels.length === 0 && templateYaml.preset && templateYaml.preset.labels) {
                prLabels = templateYaml.preset.labels;
            }
        }
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
        console.log('pr title:', prTitle, 'pr descriptioin:', prDescription)
        core.setOutput('base-branch', baseBranch);
        core.setOutput('base-version', baseVersion);
        core.setOutput('head-branch', baseBranch);
        core.setOutput('head-version', baseVersion);
        core.setOutput('is-prerelease', isPrerelease);
        core.setOutput('pr-create-draft', prCreateDraft);

        // additional checking if need to check fail-if-exist
        console.log('Action [pr-fail-if-exist] is set: ' +
            `${prFailIfExist === 'true' && 'true' || 'false'}`);
        if (prFailIfExist === 'true') {
            // get the pr with the same head and base
            const prListResponse = await octokit.pulls.list({
                owner: owner,
                repo: repo,
                head: headBranch,
                base: baseBranch
            });
            // pr found
            if (prListResponse.data.length) {
                // pr is closed
                if (prListResponse.data[0].state === 'closed') {
                    throw new Error(`The pull request to base branch: ${baseBranch}` +
                        ` from head branch: ${headBranch} has been closed.`);
                } else {
                    throw new Error(
                        `Not allowed to re-issue a pull request to base branch: ${baseBranch}` +
                        ` from head branch: ${headBranch}.`);
                }
            }
        }
        // create a pr with the above title and description.
        const prCreateResponse = await octokit.pulls.create({
            owner: owner,
            repo: repo,
            head: headBranch,
            base: baseBranch,
            title: prTitle || undefined,
            body: prDescription || undefined,
            draft: prCreateDraft === 'true'
        });
        core.setOutput('pull-request-number', prCreateResponse.data.number);
        core.setOutput('pull-request-url', prCreateResponse.url);
        // add assignee if needed
        const assignees: string[] = [];
        if (prAssignees.length) {
            // check if a user can be assigned, filter non-assignable users
            // see: https://octokit.github.io/rest.js/v18#issues-check-user-can-be-assigned
            await Promise.allSettled(
                prAssignees.map(async (assignee) => {
                    let neg = 'not ';
                    const res = await octokit.issues.checkUserCanBeAssigned({
                        owner: owner,
                        repo: repo,
                        assignee: assignee
                    });
                    if (res.headers.status === String(StatusCodes.NO_CONTENT)) {
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
                    issue_number: prCreateResponse.data.number,
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
                pull_number: prCreateResponse.data.number,
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
                issue_number: prCreateResponse.data.number,
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
