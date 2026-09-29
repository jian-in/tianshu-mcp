import {describe,it,expect} from 'vitest';
import {QoderCdpClient} from '../../src/agents/qoder/cdp.js';
import {configureModel,type QoderModelSource,type WaitFor} from '../../src/agents/qoder/model.js';

class ModelControls extends QoderCdpClient {
  groups={default:['Built-in'],custom:['Custom']};
  grouped=true;
  flat:string[]=[];
  source:QoderModelSource='custom';
  selectedSource:QoderModelSource='custom';
  selected='Custom';
  menu=false;
  dialog=false;
  options=false;
  stored='低';
  draft='低';
  levels=['低','中','高','极高'];
  saves=0;
  managementOpens=0;
  ignoreSave=false;
  delayedClose=false;
  closingReads=0;
  constructor(){super(1,1);}
  override async text(css:string){return css===this.selector('model')?`${this.selected}\n${this.stored}`:this.draft;}
  override async evaluate<T>(expr:string):Promise<T>{
    if(expr.includes("getAttribute('data-value')"))return this.selectedSource as T;
    if(expr.includes('menuitemradio'))return this.levels as T;
    if(expr.includes('data-chat-model-selector-list'))return (this.grouped?this.groups[this.source]:this.flat) as T;
    throw new Error(`Unexpected read: ${expr}`);
  }
  override async exists(css:string){
    // 选择器已分层：桩按候选集回答「在不在」，与生产 resolveKey/existsKey/clickKey 对齐。
    if(this.candidates('model').includes(css))return true;
    if(this.candidates('modelList').includes(css))return true;
    if(this.candidates('modelMenu').includes(css)){
      if(this.closingReads>0&&--this.closingReads===0)this.menu=false;
      return this.menu;
    }
    if(this.candidates('modelDialog').includes(css))return this.dialog;
    if(this.candidates('levelItem').includes(css))return this.options;
    if(css.includes('[aria-selected="true"]'))return css.includes(`data-value="${this.source}"`);
    if(css.endsWith('[role="tab"][data-value="default"]'))return this.grouped;
    if(css.includes('思考强度'))return this.dialog;
    throw new Error(`Unexpected control: ${css}`);
  }
  override async click(css:string,text?:string,index?:number){
    const group=/data-value="(default|custom)"/.exec(css)?.[1] as QoderModelSource|undefined;
    if(group){this.source=group;return;}
    if(css===this.selector('model')){this.menu=!this.menu;this.source=this.selectedSource;return;}
    if(css===this.selector('modelList')){this.selected=(this.grouped?this.groups[this.source]:this.flat)[index!]!;this.selectedSource=this.source;if(this.delayedClose)this.closingReads=2;else this.menu=false;return;}
    if(text==='模型管理'){this.dialog=true;this.menu=false;this.draft=this.stored;this.managementOpens++;return;}
    if(css.includes('思考强度')){this.options=true;return;}
    if(css===this.selector('levelItem')){this.draft=text!;this.options=false;return;}
    if(text==='保存设置'){this.saves++;if(!this.ignoreSave)this.stored=this.draft;this.dialog=false;return;}
    if(css.includes('aria-label="关闭"')){this.dialog=false;return;}
    throw new Error(`Unexpected click: ${css} ${text}`);
  }
}
const wait:WaitFor=async(check,stage)=>{for(let i=0;i<3;i++)if(await check())return;throw new Error(`state not reached: ${stage}`);};
describe('Qoder model management controls',()=>{
  it('waits for asynchronous menu dismissal when reselecting the current model',async()=>{
    const c=new ModelControls();c.delayedClose=true;
    const result=await configureModel(c,{model:'Custom',source:'custom',level:'low'},wait);
    expect(result.level).toBe('low');expect(c.managementOpens).toBe(2);
  });
  it('persists the selected level and verifies it by reopening model management',async()=>{
    const c=new ModelControls();const r=await configureModel(c,{model:'Built-in',source:'default',level:'xhigh'},wait);
    expect(r).toEqual({model:'Built-in',source:'default',level:'xhigh',globalChanged:true});
    expect(c.managementOpens).toBe(2);expect(c.saves).toBe(1);expect(c.dialog).toBe(false);
  });
  it('rejects an unsupported maximum without saving a lower level',async()=>{
    const c=new ModelControls();await expect(configureModel(c,{model:'Custom',source:'custom',level:'max'},wait)).rejects.toThrow('reasoning_unsupported');
    expect(c.saves).toBe(0);expect(c.stored).toBe('低');
  });
  it('detects a save that did not persist',async()=>{
    const c=new ModelControls();c.ignoreSave=true;
    await expect(configureModel(c,{level:'high'},wait)).rejects.toThrow('persisted-reasoning');
    expect(c.managementOpens).toBe(2);
  });
  it('retains the current group and level when parameters are omitted',async()=>{
    const c=new ModelControls();c.groups.default=['Custom'];
    expect(await configureModel(c,{},wait)).toEqual({model:'Custom',source:'custom',level:'low',globalChanged:false});
    expect(c.managementOpens).toBe(0);expect(c.saves).toBe(0);
  });
  it('rejects cross-group ambiguity for an explicitly named model',async()=>{
    const c=new ModelControls();c.groups.default=['Custom'];
    await expect(configureModel(c,{model:'Custom'},wait)).rejects.toThrow('model_ambiguous');expect(c.saves).toBe(0);
  });
  it('drives a flat (ungrouped) model menu as shipped by 0.4.2',async()=>{
    // 0.4.2 菜单移除了「默认/自定义」分组 tab，模型是一张平铺列表。
    const c=new ModelControls();
    c.grouped=false;
    c.flat=['Auto','Qwen3.8-Max','DeepSeek-Flash'];
    c.selected='Auto';
    const r=await configureModel(c,{},wait);
    expect(r.model).toBe('Auto');
    expect(c.managementOpens).toBe(0);
    expect(c.saves).toBe(0);
  });
  it('finds an explicitly named model in a flat menu',async()=>{
    const c=new ModelControls();
    c.grouped=false;
    c.flat=['Auto','Qwen3.8-Max'];
    c.selected='Auto';
    const r=await configureModel(c,{model:'Qwen3.8-Max'},wait);
    expect(r.model).toBe('Qwen3.8-Max');
  });
});
