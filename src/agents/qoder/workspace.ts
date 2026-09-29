import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { QoderCdpClient } from './cdp.js';
import type { WaitFor } from './model.js';
import { listOwnedDialogs, selectQoderFolder } from './dialog.js';

export function normalizeWorkspacePath(value: string, platform:NodeJS.Platform=process.platform): string {
  const normalized=(platform==='win32'?path.win32:path.posix).normalize(value).replace(/\\/g,'/').replace(/\/$/,'');
  return platform==='win32'?normalized.toLowerCase():normalized;
}
export async function boundWorkspace(c:QoderCdpClient):Promise<string> {
  // 0.3.4：已绑定工作区的路径在 title 上；0.4.3 真机（2026-09-29）改为
  // [data-conversation-workspace] 的无 title 形态，路径落在其内层文案（aria-label/文本）。
  // 容器一侧并列全部候选（含无 title 形态）并允许回退 aria-label/文本；输入栏 picker 的
  // aria-label 是提示语（「切换或清空当前工作区…」）而非路径，故 picker 一侧仍只认 title。
  const containers=c.candidates('conversationWorkspace').join(',');
  return c.evaluate(`(()=>{
    const vis=e=>!!e&&!!e.getBoundingClientRect().width;
    const containers=[...document.querySelectorAll(${JSON.stringify(containers)})].filter(vis).map(e=>e.getAttribute('title')||e.getAttribute('aria-label')||e.textContent||'');
    const pickers=[...document.querySelectorAll(${JSON.stringify(c.selector('workspace'))})].filter(vis).map(e=>e.getAttribute('title')||'');
    const a=[...containers,...pickers].map(s=>s.trim()).filter(Boolean);
    return new Set(a).size===1?a[0]:'';
  })()`);
}
export async function assertWorkspace(c:QoderCdpClient,project:string):Promise<void> {
  const actual=await boundWorkspace(c);
  if(!actual||normalizeWorkspacePath(actual)!==normalizeWorkspacePath(project)) throw new Error(`qoder_workspace_mismatch: expected=${project}, actual=${actual}`);
}
/** 工作区下拉就绪的唯一可靠证据：搜索框出现。泛化的 [data-state=open] 会被页面其他浮层误命中。 */
const workspaceMenuOpen=(c:QoderCdpClient):Promise<boolean>=>c.existsKey('workspaceSearch');

/** 点击后的短促复核（不占用 wait 的全局预算）：下拉是否已经出现。 */
async function workspaceMenuAppeared(c:QoderCdpClient,timeoutMs=2500):Promise<boolean> {
  const deadline=Date.now()+timeoutMs;
  for(;;){
    if(await workspaceMenuOpen(c))return true;
    if(Date.now()>=deadline)return false;
    await delay(100);
  }
}

/**
 * 打开工作区下拉，并确认它**真的**打开了。
 *
 * 2026-09-24 真机诊断（本机 Qoder CN 0.4.2）：
 *  1. 「菜单已开」的旧判定 `workspaceSearch || workspaceMenu` 里的 workspaceMenu 形如
 *     [role=menu][data-state=open]，会被页面无关浮层命中，造成假通过，随后找搜索框才发现没有。
 *     → 判定收窄为只认搜索框；点击落空时复核并再点一次。
 *  2. 曾试过让 click() 要求「可见匹配恰好为 1」来避坑，但实测 0.4.2 的回退候选
 *     （[data-workspace-picker-trigger] / [aria-expanded][aria-label*=工作区]）**都是 2 个可见**，
 *     一旦主选择器未就绪而回退，要求唯一就必然超时。故保留 index=0（多匹配取首个可见），
 *     点对了没有交给下面的复核回答。
 */
async function openWorkspaceMenu(c:QoderCdpClient,wait:WaitFor):Promise<void> {
  // 页面刚切过来时触发器可能尚未就绪，先等它出现再点（避免一次空点）。
  await wait(()=>c.existsKey('workspace'),'workspace-picker');
  for(let attempt=0;attempt<2;attempt++){
    try{
      await c.clickKey('workspace',undefined,0);
      if(await workspaceMenuAppeared(c))return;
    }catch{
      // 点击未能发出（元素未就绪/被遮挡）；交给下一轮重试或下方的 wait 定调
    }
  }
  try {
    await wait(()=>workspaceMenuOpen(c),'workspace-menu');
  } catch (error) {
    // 附页面可见候选，便于定位 UI 漂移
    const labels = await c.visibleLabels();
    const hint = labels.length ? `；页面可见候选=[${labels.join(' | ')}]` : '';
    throw new Error(`${(error as Error).message}${hint}`);
  }
}

/** 点击候选项后的短促复核（不占用 wait 的全局预算）：下拉是否已关闭。 */
async function workspaceMenuClosed(c:QoderCdpClient,timeoutMs=2500):Promise<boolean> {
  const deadline=Date.now()+timeoutMs;
  for(;;){
    if(!await c.exists(c.selector('workspaceSearch')))return true;
    if(Date.now()>=deadline)return false;
    await delay(100);
  }
}

export async function bindWorkspace(c:QoderCdpClient,project:string,wait:WaitFor,native:{pids:number[];timeoutMs:number;signal?:AbortSignal;list?:typeof listOwnedDialogs;select?:typeof selectQoderFolder}):Promise<void> {
  const current=await boundWorkspace(c);
  if(current&&normalizeWorkspacePath(current)===normalizeWorkspacePath(project))return;
  await openWorkspaceMenu(c,wait);
  await c.fill(c.selector('workspaceSearch'),process.platform==='win32'?path.win32.normalize(project):project);
  // UI filters by name OR path; selection is always followed by full-path verification.
  await wait(async()=>await c.evaluate<boolean>(`document.querySelector(${JSON.stringify(c.selector('workspaceSearch'))})?.value===${JSON.stringify(process.platform==='win32'?path.win32.normalize(project):project)}`),'workspace-search');
  const count=await c.evaluate<number>(`document.querySelectorAll(${JSON.stringify(c.selector('workspaceItem'))}).length`);
  if(count>1)throw new Error('qoder_workspace_ambiguous');
  if(count===1){
    // 0.4.3 真机：候选项点击偶发落空（列表重排/动画期间坐标漂移），点后短促复核，
    // 未关闭则再点一次；两次都不生效才交给下面的 wait 定调，避免白等一整个 stage 预算。
    for(let attempt=0;attempt<2;attempt++){
      await c.click(c.selector('workspaceItem'));
      if(await workspaceMenuClosed(c))break;
    }
    await wait(async()=>!await c.exists(c.selector('workspaceSearch')),'workspace-selected');
    await assertWorkspace(c,project);return;
  }
  await c.click('[role="menu"][data-state="open"] [role="menuitem"]','新建工作区');
  await wait(()=>c.exists(c.selector('workspaceForm')),'workspace-form');
  const before=await (native.list??listOwnedDialogs)(native.pids,{timeoutMs:native.timeoutMs,signal:native.signal});
  await c.click(c.selector('folderAdd'));
  const selected=await (native.select??selectQoderFolder)(project,native.pids,before,{timeoutMs:native.timeoutMs,signal:native.signal});
  if(!selected.ok)throw new Error(`qoder_folder_dialog: ${selected.message}`);
  await wait(async()=>{
    const paths=await c.evaluate<string[]>(`[...document.querySelectorAll(${JSON.stringify(c.selector('workspaceForm')+' [title]')})].filter(e=>e.getBoundingClientRect().width).map(e=>e.getAttribute('title'))`);
    return paths.some(p=>normalizeWorkspacePath(p)===normalizeWorkspacePath(project));
  },'source-folder-readback');
  await c.fill(c.selector('workspaceName'),(process.platform==='win32'?path.win32:path.posix).basename(project));
  await c.click(c.selector('workspaceCreate'));
  await wait(async()=>!await c.exists(c.selector('workspaceForm')),'workspace-created');
  await assertWorkspace(c,project);
}
