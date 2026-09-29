import type { QoderCdpClient } from './cdp.js';

export type QoderModelSource = 'default' | 'custom';
export type QoderLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'off';
export const LEVEL_LABELS: Record<QoderLevel,string> = {low:'低',medium:'中',high:'高',xhigh:'极高',max:'最大',off:'关闭思考'};
export function normalizeLevel(value?: string): QoderLevel | undefined {
  if (value === undefined) return undefined;
  const aliases: Record<string,QoderLevel> = {低:'low',中:'medium',高:'high',极高:'xhigh',最大:'max',关闭思考:'off',low:'low',medium:'medium',high:'high',xhigh:'xhigh',max:'max',off:'off'};
  const level=aliases[value.normalize('NFKC').trim().toLowerCase()];
  if(!level)throw new Error(`qoder_reasoning_unsupported: ${value}`);
  return level;
}
export const exactName = (a: string,b: string): boolean => a.normalize('NFKC').trim().toLowerCase() === b.normalize('NFKC').trim().toLowerCase();
export interface ModelChoice {name:string;source:QoderModelSource;index:number}
export function matchModel(items: ModelChoice[],name: string,source?: QoderModelSource): ModelChoice {
  const matches=items.filter(i=>exactName(i.name,name)&&(!source||i.source===source));
  if(matches.length!==1)throw new Error(`${matches.length?'qoder_model_ambiguous':'qoder_model_missing'}: ${name}; available=${items.map(i=>i.source+'/'+i.name).join(', ')}`);
  return matches[0]!;
}
export type WaitFor = (check:()=>Promise<boolean>,stage:string)=>Promise<void>;

export async function configureModel(c: QoderCdpClient, requested: {model?:string;source?:QoderModelSource;level?:string},wait: WaitFor): Promise<{model:string;source:QoderModelSource;level?:QoderLevel;globalChanged:boolean}> {
  const level=normalizeLevel(requested.level);
  // 0.3.4 触发器 aria-label=「模型:<名>」；0.4.2 退化为「模型」，模型名移到按钮文本。按候选探测读取。
  const trigger=await c.textKey('model');
  const name=requested.model ?? trigger.split('\n')[0]?.trim();
  if(!name)throw new Error('qoder_model_unreadable');
  await c.clickKey('model');
  await wait(()=>c.existsKey('modelMenu'),'model-menu');
  const menu=(await c.resolveKey('modelMenu'))??c.selector('modelMenu');
  const list=(await c.resolveKey('modelList'))??c.selector('modelList');
  const items:ModelChoice[]=[];
  // 0.3.4 菜单内置「默认/自定义」分组 tab；0.4.2 已移除，模型是一张平铺列表。
  const grouped=await c.exists(`${menu} [role="tab"][data-value="default"]`);
  let selectedSource:QoderModelSource|undefined;
  if(grouped){
    selectedSource=await c.evaluate<QoderModelSource>(`document.querySelector(${JSON.stringify(menu)})?.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('data-value')`);
    for(const source of ['default','custom'] as const){
      await c.click(`${menu} [role="tab"][data-value="${source}"]`);
      await wait(()=>c.exists(`${menu} [role="tab"][data-value="${source}"][aria-selected="true"]`),'model-source');
      const names=await c.evaluate<string[]>(`[...document.querySelectorAll(${JSON.stringify(list)})].map(e=>e.innerText.trim().split('\\n')[0])`);
      names.forEach((n,index)=>items.push({name:n,source,index}));
    }
  }else{
    const names=await c.evaluate<string[]>(`[...document.querySelectorAll(${JSON.stringify(list)})].map(e=>e.innerText.trim().split('\\n')[0])`);
    names.forEach((n,index)=>items.push({name:n,source:'default',index}));
  }
  // Omitting model retains the current group, even when the same name exists in both groups.
  const choice=matchModel(items,name,requested.source??(requested.model?undefined:selectedSource));
  if(grouped){
    await c.click(`${menu} [role="tab"][data-value="${choice.source}"]`);
    await wait(()=>c.exists(`${menu} [role="tab"][data-value="${choice.source}"][aria-selected="true"]`),'model-source');
  }
  await c.click(list,undefined,choice.index);
  await wait(async()=>!await c.existsKey('modelMenu'),'model-menu-closed');
  await wait(async()=>exactName((await c.textKey('model')).split('\n')[0]??'',choice.name),'model-readback');
  let globalChanged=false;
  if(level!==undefined){
    await c.clickKey('model');
    await wait(()=>c.existsKey('modelMenu'),'model-menu');
    await c.click(`${menu} [role="menuitem"]`,'模型管理');
    await wait(()=>c.existsKey('modelDialog'),'model-management');
    const dialog=(await c.resolveKey('modelDialog'))??c.selector('modelDialog');
    const levelButton=`${dialog} button[aria-label=${JSON.stringify(`设置 ${choice.name} 的思考强度`)}]`;
    if(grouped){
      await c.click(`${dialog} [role="tab"][data-value="${choice.source}"]`);
      await wait(()=>c.exists(`${dialog} [role="tab"][data-value="${choice.source}"][aria-selected="true"]`),'management-source');
    }
    if(!await c.exists(levelButton))throw new Error(`qoder_reasoning_unsupported: ${choice.name}`);
    const before=await c.text(levelButton);
    await c.click(levelButton);
    await wait(()=>c.existsKey('levelItem'),'reasoning-options');
    const levelItem=(await c.resolveKey('levelItem'))??c.selector('levelItem');
    const labels=await c.evaluate<string[]>(`[...document.querySelectorAll(${JSON.stringify(levelItem)})].map(e=>e.innerText.trim())`);
    if(!labels.includes(LEVEL_LABELS[level]))throw new Error(`qoder_reasoning_unsupported: ${LEVEL_LABELS[level]}; available=${labels.join(',')}`);
    await c.click(levelItem,LEVEL_LABELS[level]);
    await wait(async()=>(await c.text(levelButton)).trim()===LEVEL_LABELS[level],'reasoning-readback');
    globalChanged=before.trim()!==LEVEL_LABELS[level];
    if(globalChanged){
      await c.click(`${dialog} button`,'保存设置');
    }else await c.click(`${dialog} button[aria-label="关闭"]`);
    await wait(async()=>!await c.exists(dialog),'settings-saved');
    // Reopen persisted preferences, not just the draft row, to prove saving took effect.
    await c.clickKey('model'); await wait(()=>c.existsKey('modelMenu'),'model-menu');
    await c.click(`${menu} [role="menuitem"]`,'模型管理');
    await wait(()=>c.existsKey('modelDialog'),'model-management');
    if(grouped){
      await c.click(`${dialog} [role="tab"][data-value="${choice.source}"]`);
    }
    await wait(async()=>await c.exists(levelButton)&&(await c.text(levelButton)).trim()===LEVEL_LABELS[level],'persisted-reasoning');
    await c.click(`${dialog} button[aria-label="关闭"]`);
    await wait(async()=>!await c.exists(dialog),'settings-closed');
  }
  const actual=(await c.textKey('model')).split('\n').map(s=>s.trim());
  if(!exactName(actual[0]??'',choice.name))throw new Error('qoder_model_readback_failed');
  return {model:choice.name,source:choice.source,level:level??(actual[1]?normalizeLevel(actual[1]):undefined),globalChanged};
}
