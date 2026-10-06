/** Never adopt old unowned browser saves when someone signs in. */
let owner:string|null=null;
export function setLocalWorkspaceOwner(id:string|null){owner=id;}
export const accountLocalStorage={
  getItem:(key:string)=>owner?localStorage.getItem(`fm.user.${owner}.${key}`):null,
  setItem:(key:string,value:string)=>{if(owner)localStorage.setItem(`fm.user.${owner}.${key}`,value);},
  removeItem:(key:string)=>{if(owner)localStorage.removeItem(`fm.user.${owner}.${key}`);},
};
