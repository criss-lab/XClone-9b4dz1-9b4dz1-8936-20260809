import * as React from 'react';
import { cn } from '@/lib/utils';
export interface ToggleProps extends React.ButtonHTMLAttributes<HTMLButtonElement>{pressed?:boolean;onPressedChange?:(pressed:boolean)=>void;variant?:string;size?:string;}
export const Toggle=React.forwardRef<HTMLButtonElement,ToggleProps>(({className,pressed,onPressedChange,onClick,...props},ref)=><button ref={ref} type="button" aria-pressed={pressed} data-state={pressed?'on':'off'} className={cn('inline-flex items-center justify-center rounded-md',className)} onClick={e=>{onPressedChange?.(!pressed);onClick?.(e)}} {...props}/>);
Toggle.displayName='Toggle';
