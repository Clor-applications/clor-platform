/**
 * Passwords too common to accept (SX-15).
 *
 * Kept offline on purpose: no password, or a hash of one, leaves the server to
 * be checked. Only entries of 8 characters or more are listed, since anything
 * shorter already fails the minimum length. Compared in lower case, so
 * "Password123" is caught as "password123". Includes the Indian favourites
 * that show up in leaked lists alongside the global ones.
 */
const LIST = `
password password1 password12 password123 password1234 password@123 password!
passw0rd p@ssw0rd p@ssword p@ssword1 p@ssw0rd1 pass1234 pass@123 pass@1234 passpass
12345678 123456789 1234567890 0123456789 87654321 987654321 9876543210
11111111 00000000 22222222 88888888 99999999 12341234 11223344 12121212
123123123 147258369 159753258 123456789a 1234567a a1234567 aa123456 abc12345
abcd1234 abcdefgh abc123456 qwerty12 qwerty123 qwerty1234 qwerty@123 qwertyuiop
qwertyui qwerty12345 1qaz2wsx 1q2w3e4r 1q2w3e4r5t q1w2e3r4 q1w2e3r4t5 zaq12wsx
qweasdzxc 123qweasd 1234qwer qazwsxedc asdfghjk asdfghjkl asdf1234 zxcvbnm1
zxcvbnmm iloveyou iloveyou1 sunshine princess football baseball superman
starwars trustno1 letmein1 letmein123 welcome1 welcome123 welcome@123
whatever computer internet michelle jennifer jordan23 liverpool chelsea1
arsenal1 manchester monkey123 dragon123 master123 shadow123 killer123
admin123 admin@123 admin1234 administrator test1234 testtest test@123
changeme changeme1 default1 secret123 letmein! iloveindia india123 india@123
bharat123 hindustan krishna123 ganesh123 sairam123 omsairam jaihind1
jaishreeram jaimatadi mahadev1 hanuman1 cricket1 cricket123 sachin10
mumbai123 delhi123 bangalore chennai1 hyderabad kolkata1 pune1234
`;

const COMMON = new Set(LIST.split(/\s+/).filter((w) => w.length >= 8));

/** True when the password is on the list, or is one character repeated. */
export function isCommonPassword(password: string) {
  const value = String(password || '').toLowerCase();
  return COMMON.has(value) || /^(.)\1+$/.test(value);
}
