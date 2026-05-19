import { runCommandStoreCheck } from './src/app/map/test/commandStoreCheck';
runCommandStoreCheck().then(result => console.log(JSON.stringify(result)));
