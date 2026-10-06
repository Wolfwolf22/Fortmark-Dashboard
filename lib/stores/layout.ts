"use client";
import { create } from "zustand";
import type { DateRangePreset } from "@/lib/data/types";
import { DEFAULT_WIDGET_ORDER, type WidgetId } from "./widget-order";
import { layoutSchema } from "../workspaces/contract";
export { DEFAULT_WIDGET_ORDER } from "./widget-order";
export type { WidgetId } from "./widget-order";
interface LayoutState {
  widgetOrder:WidgetId[];widgetPeriods:Partial<Record<WidgetId,DateRangePreset|null>>;
  setWidgetOrder:(order:WidgetId[])=>void;resetLayout:()=>void;setWidgetPeriod:(id:WidgetId,preset:DateRangePreset|null)=>void;
}
type LayoutData=Pick<LayoutState,'widgetOrder'|'widgetPeriods'>;
let storage:Pick<Storage,'setItem'>|null=null;
const defaults=():LayoutData=>({widgetOrder:[...DEFAULT_WIDGET_ORDER],widgetPeriods:{}});
export function connectLayoutStorage(next:Pick<Storage,'getItem'|'setItem'>|null){
  storage=next;let value=defaults();
  if(next){try{const raw=next.getItem('layout');if(raw){const parsed=layoutSchema.parse(JSON.parse(raw));value={...parsed,widgetOrder:[...parsed.widgetOrder,...DEFAULT_WIDGET_ORDER.filter(id=>!parsed.widgetOrder.includes(id))]};}}catch{/* Invalid data never replaces the safe default. */}}
  useLayoutStore.setState(value);
}
export const useLayoutStore=create<LayoutState>((set,get)=>{
  const update=(value:LayoutData)=>{if(!storage)return;try{storage.setItem('layout',JSON.stringify(value));set(value);}catch{/* The account save status explains the blocked write. */}};
  return {...defaults(),setWidgetOrder:widgetOrder=>update({widgetOrder,widgetPeriods:get().widgetPeriods}),resetLayout:()=>update(defaults()),setWidgetPeriod:(id,preset)=>update({widgetOrder:get().widgetOrder,widgetPeriods:{...get().widgetPeriods,[id]:preset}})};
});
