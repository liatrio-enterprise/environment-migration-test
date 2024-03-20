const sodium = require('libsodium-wrappers');

const envs = process.env.ENVS;
console.log(envs);
const secret = 'BRUH';
// const key = envs.secrets[0].key;
// const key = '9xcikbh/ZnM2sApwzd/s+6L3BliMaxVLSuW14GcHVlM='
let key = '';

let newEnvs = [];

for ( const env in envs){
    let envObj = {
        name: env.name,
        secrets: env.secrets,
        key_id: env.key_id,
        key: env.key,
        encrypted: '',
      };
    key = env.key;
    //Check if libsodium is ready and then proceed.
    sodium.ready.then(() => {
        // Convert the secret and key to a Uint8Array.
        let binkey = sodium.from_base64(key, sodium.base64_variants.ORIGINAL);
        let binsec = sodium.from_string(secret);
    
        // Encrypt the secret using libsodium
        let encBytes = sodium.crypto_box_seal(binsec, binkey);
    
        // Convert the encrypted Uint8Array to Base64
        let output = sodium.to_base64(encBytes, sodium.base64_variants.ORIGINAL);
    
        // Print and save the output
        console.log(output);
        envObj.encrypted = output;
        newEnvs.push(envObj);
    });
    
}

// Show results
console.log(newEnvs);
return newEnvs;