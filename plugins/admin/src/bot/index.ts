import {Plugin} from 'oitq';
import * as group from './group'
import * as privatePlugin from './private'
export const name='admin.bot'
export function install(ctx:Plugin){
    ctx.command('admin/bot','message')
        .desc('机器人管理相关指令')
    ctx.plugin(privatePlugin)
    ctx.plugin(group)
}