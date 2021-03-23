import * as core from '@actions/core';
import * as github from '@actions/github';
import axios, { AxiosRequestConfig } from 'axios';
import yaml from 'yaml';


interface PrTemplate {
    title: string;
    description?: string;
    preset?: {
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

async function main(): Promise<void> {
    try {
        const [owner, repo] = github.context.payload.repository.full_name.split('/');
        const [, refType, refName] = /(?<=refs\/)([^\/]*)\/(\S*)/gm.exec(String(github.context.payload.ref)) || [];
        const isBranch = refType === 'heads';
        // const isTag = refType === 'tags';
        const mainBranch = github.context.payload.repository.default_branch || 'main';
        const baseBranch = core.getInput('base-branch') || '';
        const headBranch = isBranch && refName;
        const isPrerelease = core.getInput('is-prerelease') || '';
        const prCreateDraft = core.getInput('pr-create-draft') || '';
        const prUpdateIfExist = core.getInput('pr-update-if-exist') || '';
        const prTemplateUri = core.getInput('pr-template-uri') || '';
        let prTitle: string = core.getInput('pr-title') || '';
        let prDescription: string = core.getInput('pr-description') || '';
        const inputPrReviewers = core.getInput('pr-reviewers') || '';
        const inputPrTeamReviewers = core.getInput('pr-team-reviewers') || '';
        const inputPrLabels = core.getInput('pr-labels') || '';
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
            // NOTE: optional chaining works in NodeJS 12 and higher version only
            if (prReviewers.length === 0 && templateYaml.preset?.reviewers) {
                prReviewers = templateYaml.preset.reviewers;
            }
            if (prTeamReviewers.length === 0 && templateYaml.preset?.['team-reviewers']) {
                prTeamReviewers = templateYaml.preset['team-reviewers'];
            }
            if (prLabels.length === 0 && templateYaml.preset?.labels) {
                prLabels = templateYaml.preset.labels;
            }
        }
        console.log('prReviewers:', prReviewers);
        console.log('prTeamReviewers:', prTeamReviewers);
        console.log('prLabels:', prLabels);
        // replace place holders in template
        const replace = (str: string): string => {
            return str
                .replace(new RegExp('${base-version}', 'g'), baseVersion)
                .replace(new RegExp('${head-version}', 'g'), headVersion)
                .replace(new RegExp('${is-prerelease}', 'g'), isPrerelease);
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
        core.setOutput('pr-update-if-exist', prUpdateIfExist);
        core.setOutput('pull-request-url', 'not-yet-set');
        // Get the JSON webhook payload for the event that triggered the workflow
        const payload = JSON.stringify(github.context.payload, null, 4);
        console.log('payload:', payload);
    } catch (error) {
        core.setFailed((error as Error).message);
    }
}

main();
