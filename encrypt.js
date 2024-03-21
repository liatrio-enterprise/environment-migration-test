const sodium = require('libsodium-wrappers');
const core = require('@actions/core');

// const envs = process.env.ENVS;
const envs = JSON.parse(process.env.ENVS);
// const envs = [{"name":"test","secrets":[{"name":"TEST_SECRET","value":{"name":"TEST_SECRET","created_at":"2024-03-18T16:55:03Z","updated_at":"2024-03-19T21:58:28Z"}}],"key_id":"3380204578043523366","key":"9xcikbh/ZnM2sApwzd/s+6L3BliMaxVLSuW14GcHVlM="}];
console.log("ENVS Output");
console.log(envs);
const secret = 'BRUH';
// const key = envs.secrets[0].key;
// const key = '9xcikbh/ZnM2sApwzd/s+6L3BliMaxVLSuW14GcHVlM='
// let key = '';

let newEnvs = [];

const result = processEnvs(envs, secret);
// After your logic, set the output
core.setOutput('encrypted_output', result);
// return result;

// for ( const env of envs){
//     let envObj = {
//         name: env.name,
//         secrets: env.secrets,
//         key_id: env.key_id,
//         key: env.key,
//         encrypted: '',
//       };
//     key = env.key;
//     console.log("Key: " + key);
    //Check if libsodium is ready and then proceed.
    // const result = sodium.ready.then(() => {
    //     // Convert the secret and key to a Uint8Array.
    //     let binkey = sodium.from_base64(key, sodium.base64_variants.ORIGINAL);
    //     let binsec = sodium.from_string(secret);
    
    //     // Encrypt the secret using libsodium
    //     let encBytes = sodium.crypto_box_seal(binsec, binkey);
    
    //     // Convert the encrypted Uint8Array to Base64
    //     let output = sodium.to_base64(encBytes, sodium.base64_variants.ORIGINAL);
    
    //     // Print and save the output
    //     console.log("Generated encrypted value:" + output);
    //     return output;
    // });

//     envObj.encrypted = encryptSecrets(key, secret);
//     newEnvs.push(envObj);
    
// }

// Show results
// console.log("Showing Results");
// console.log(newEnvs);
// return newEnvs;

async function encryptSecrets(key, secret){
    const result = await sodium.ready.then(() => {
        // Convert the secret and key to a Uint8Array.
        let binkey = sodium.from_base64(key, sodium.base64_variants.ORIGINAL);
        let binsec = sodium.from_string(secret);
    
        // Encrypt the secret using libsodium
        let encBytes = sodium.crypto_box_seal(binsec, binkey);
    
        // Convert the encrypted Uint8Array to Base64
        let output = sodium.to_base64(encBytes, sodium.base64_variants.ORIGINAL);
    
        // Print and save the output
        console.log("Generated encrypted value:" + output);
        return output;
    });
    return result;
}

async function processEnvs(envs, secret) {

    for (const env of envs) {
        let envObj = {
            name: env.name,
            secrets: env.secrets,
            key_id: env.key_id,
            key: env.key,
            encrypted: '',
        };
        const key = env.key;
        console.log("Key: " + key);

        envObj.encrypted = await encryptSecrets(key, secret);
        newEnvs.push(envObj);
    }

    // Show results
    console.log("Showing Results");
    console.log(newEnvs);
    return newEnvs;
}