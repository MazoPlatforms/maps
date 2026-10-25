// Executed ONLY from the trusted default/base branch by record-review.yml.
// Never imports candidate code or downloads/runs PR artifacts.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
export function adminDecision({head,author,maintainers,reviews,comments}) {
  const latest=new Map();
  for(const review of reviews) {
    if(!maintainers.includes(review.user?.login) || review.commit_id!==head || review.state==='COMMENTED')continue;
    latest.set(review.user.login,review);
  }
  if([...latest.values()].some(r=>r.state==='CHANGES_REQUESTED'))return {approved:false,reason:'An admin requested changes on this commit'};
  if([...latest.values()].some(r=>r.state==='APPROVED' && r.user.login!==author))return {approved:true,reason:'Admin review approves the current commit'};
  const pattern=new RegExp(`^/approve-records ${head}$`);
  // Explicit solo-maintainer mode. GitHub does not allow approving one's own PR.
  if(maintainers.length===1 && maintainers.includes(author) && comments.some(c=>c.user?.login===author && pattern.test(c.body.trim())))return {approved:true,reason:'Maintainer explicitly approved their own exact commit'};
  return {approved:false,reason:'Admin approval of the current commit is required'};
}
async function main() {
  const event=JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH,'utf8'));
  if(event.issue && !event.issue.pull_request)return;
  const number=event.pull_request?.number || event.issue?.number;
  if(!number)throw Error('No pull request event');
  const repository=process.env.GITHUB_REPOSITORY;
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))throw Error('Invalid repository');
  async function api(path,options={}) {
    const response=await fetch(`https://api.github.com/repos/${repository}/${path}`,{...options,headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${process.env.GITHUB_TOKEN}`,'X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'}});
    if(!response.ok)throw Error(`GitHub API returned ${response.status}`);return response.json();
  }
  async function pages(path) {
    const all=[];for(let page=1;page<=100;page++){const batch=await api(`${path}?per_page=100&page=${page}`);all.push(...batch);if(batch.length<100)return all;}throw Error('Review history exceeds pagination limit');
  }
  const pr=await api(`pulls/${number}`);if(pr.state!=='open')return;
  const maintainers=JSON.parse(await readFile(new URL('../.github/record-maintainers.json',import.meta.url),'utf8')).maintainers;
  const [reviews,comments]=await Promise.all([pages(`pulls/${number}/reviews`),pages(`issues/${number}/comments`)]);
  const decision=adminDecision({head:pr.head.sha,author:pr.user.login,maintainers,reviews,comments});
  await api(`statuses/${pr.head.sha}`,{method:'POST',body:JSON.stringify({state:decision.approved?'success':'pending',context:'Community admin approval',description:decision.reason,target_url:pr.html_url})});
  console.log(decision.reason);
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) main().catch(error=>{console.error(error.message);process.exitCode=1;});
