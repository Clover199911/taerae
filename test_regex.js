const testHtml = `>Stage Name:</span> Sullin (설린 / ソルリン)
>Stage Name:</span> Park SoHyun (박소현)
>Stage Name:</span> JiYeon (지연)
>Stage Name:</span> Kaede (楓 / かえで)
>Stage Name:</span> Park Shion (박시온)
>Stage Name:</span> Lynn (린)`;

const members = [];
const stageNameMatches = testHtml.matchAll(/>Stage Name:<\/span>\s*([A-Za-z]+(?:\s[A-Za-z]+)?)/gi);
for (const match of stageNameMatches) {
    let name = match[1].trim();
    name = name.split('(')[0].trim();
    if (name.includes(' ')) {
        const parts = name.split(' ');
        if (['Park', 'Lee', 'Kim', 'Choi', 'Jung', 'Kang', 'Yoon', 'Shin'].includes(parts[0])) {
            name = parts.slice(1).join('');
        } else {
            name = parts[0];
        }
    }
    if (name && name.length > 1 && !members.includes(name)) {
        members.push(name);
    }
}
console.log('Found members:', members);
