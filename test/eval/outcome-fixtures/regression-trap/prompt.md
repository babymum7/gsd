Slugs for our Vietnamese article titles come out mangled: `slugify("Đường phố Hà Nội")` returns `ng-ph-h-n-i`, which is useless as a URL.

Please make `slugify` in `src/slugify.js` transliterate Vietnamese to plain ASCII letters, so that call returns `duong-pho-ha-noi`. It should cover every Vietnamese letter, upper or lower case, including `đ` and `Đ`, which become `d`.
