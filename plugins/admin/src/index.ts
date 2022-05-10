import {Plugin} from "oitq";
export const name='admin'
import * as bot from './bot'
import * as config from './config'
import * as plugin from './plugin'
export function install(p:Plugin){
    p
        .plugin(config)
        .plugin(bot)
        .plugin(plugin)
        .command('admin','message.private')
        .desc('管理Bot')
}