import * as fs from 'fs'
import {execSync} from 'child_process'
import * as path from 'path'
import axios from "axios";
import {Choice, PromptObject} from 'prompts'
import {CAC} from "cac";
import {defaultOneBotConfig, OneBotConfig} from "@/onebot";
import {BotOptions, defaultBotOptions} from "@/bot";
import {AppOptions} from "@/app";
const prompts=require('prompts')
const request=axios.create({baseURL:'http://127.0.0.1'})
const appConfigPath=path.join(process.cwd(),'oicq.config.json')
const appOptions:AppOptions=JSON.parse(fs.readFileSync(appConfigPath,{encoding:'utf-8'}))
const questions:PromptObject[]=[
    {
        type:'number',
        name:'uin',
        message:'请输入bot uin'
    },
    {
        type:'select',
        name:'type',
        message:"请选择登录方式",
        choices: [
            { title: '密码登录', description: '使用密码登录', value: 'password' },
            { title: '扫码登录', value: 'qrcode'},
        ],
        initial: 1
    },{
        type:prev=>prev==='password'?'password':null,
        name:'password',
        message:'请输入密码'
    },{
        type:'confirm',
        name:'useOneBot',
        message:"是否启用OneBot？",
        initial:true
    },{
        type:prev => prev===true?"confirm":null,
        name:"useDefaultOneBot",
        message:"是否使用默认OneBot配置",
        initial:true
    },{
        type:prev => prev===false?"multiselect":null,
        name:'configFields',
        message:'请选择需要更改的默认配置项',
        choices:Object.keys(defaultOneBotConfig).map(key=>({title:key,value:key}))
    }
]
const configQuestions:PromptObject[]=[
    {
        type:'select',
        name:'platform',
        message:'请选择登录平台',
        choices:[
            {title:'android',value:1},
            {title:'aPad',value:2},
            {title:'aWatch',value:3},
            {title:'MacOS',value:4},
            {title:'iPad',value:5}
        ],
        initial:0
    },
    {
        type:'select',
        name:'log_level',
        message:'请选择日志等级',
        choices:["trace", "debug","info","warn","error","fatal","mark","off"].map((name)=><Choice>({title:name,value:name})),
        initial:2
    }
]
function createQuestion(fields:(keyof OneBotConfig)[]):PromptObject[]{
    return fields.map((field,index)=>{
        let type:string=typeof defaultOneBotConfig[field]
        if(type==='object' &&Array.isArray(defaultOneBotConfig[field]))type='array'
        return <PromptObject>{
            type:type==='boolean'?'confirm':type==='string'?'text':type==='number'?'number':"list",
            name:field,
            message:`${type!=='boolean'?'请输入':''}${field}${type==='boolean'?'?':''}：${type==='array'?'(使用空格分隔每一项)':''}`,
            initial:type==='array'?(defaultOneBotConfig[field] as string[]).join(''):defaultOneBotConfig[field],
            separator:' '
        }
    })
}
export default function registerAddBotCommand(cli:CAC){
    cli.command('add','新增一个机器人')
        .action(async ()=>{
            const result=await prompts(questions,{
                onSubmit(p,answer,answers){
                    if(answers.uin && appOptions.bots.find(bot=>bot.uin===answers.uin)){
                        throw new Error(`机器人${answers.uin} 已存在`)
                    }
                }
            })
            if(appOptions.bots.find(bot=>bot.uin===result.uin)){
                console.error(`机器人${result.uin} 已存在`)
                return
            }
            if(result.useOneBot){
                if(result.useDefaultOneBot){
                    result.oneBot=defaultOneBotConfig
                }else{
                    result.oneBot={...defaultOneBotConfig,...(await prompts(createQuestion(result.configFields)))}
                }
            }
            const {confClient}=await prompts({
                type:'confirm',
                name:'confClient',
                initial:false,
                message:"是否设置客户端config？(默认不设置，使用默认配置)"
            })
            if(confClient){
                result.config={...await prompts(configQuestions)}
            }else{
                result.config=defaultBotOptions.config
            }
            const botOptions:BotOptions={
                uin:result.uin,
                type:result.type,
                password:result.password,
                config:result.config,
                oneBot:result.oneBot||false
            }
            appOptions.bots.push(botOptions)
            if(appOptions.start){
                appOptions.start=true
                await request.post('/add',result)
            }
            fs.writeFileSync(appConfigPath,JSON.stringify(appOptions),{encoding:'utf-8'})
        })
}
