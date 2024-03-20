const sodium = require('libsodium-wrappers');

const envList = process.env.SEC_OUTPUTS_RESULT.split(',');

let envs = [];

for (const env of envList) {
  let envObj = {
    name: env.name,
    secrets: env.secrets,
    key_id: env.key_id,
    key: env.key,
    encryptedSecret: '',
  };

  const secret = 'BRUH'
  const key = env.key;

  sodium.ready.then(() => {
    let binkey = sodium.from_base64(key, sodium.base64_variants.ORIGINAL)
    let binsec = sodium.from_string(secret)

    let encBytes = sodium.crypto_box_seal(binsec, binkey)

    let output = sodium.to_base64(encBytes, sodium.base64_variants.ORIGINAL)

    envObj.encryptedSecret = output;
    envs.push(envObj);
  });
}

console.log(JSON.stringify(envs));
return envs;