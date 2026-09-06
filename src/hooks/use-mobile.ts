import * as React from 'react';
const MOBILE_BREAKPOINT=768;
export function useIsMobile(){const [isMobile,setIsMobile]=React.useState(false);React.useEffect(()=>{const on=()=>setIsMobile(window.innerWidth<MOBILE_BREAKPOINT);on();window.addEventListener('resize',on);return()=>window.removeEventListener('resize',on)},[]);return isMobile;}
export default useIsMobile;
