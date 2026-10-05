export const proficiencyNames = ['Awareness', 'Foundation', 'Practitioner', 'Advanced', 'Expert'] as const;
export function hasStandardProficiency(levels:{rank:number;name:string}[]):boolean {
 return levels.length===5&&levels.every((level,index)=>level.rank===index+1&&level.name===proficiencyNames[index]);
}
