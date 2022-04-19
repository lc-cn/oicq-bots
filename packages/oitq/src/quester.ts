import { Agent, ClientRequestArgs } from 'http'
import WebSocket from 'ws'
import {Dict} from "@oitq/utils";
import ProxyAgent from 'proxy-agent'
import axios, { AxiosRequestConfig, AxiosResponse, Method } from 'axios'
export interface Quester {
    <T = any>(method: Method, url: string, config?: AxiosRequestConfig): Promise<T>
    axios<T = any>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>>
    extend(config: Quester.Config): Quester
    config: Quester.Config
    head(url: string, config?: AxiosRequestConfig): Promise<Dict<string>>
    get<T = any>(url: string, config?: AxiosRequestConfig): Promise<T>
    delete<T = any>(url: string, config?: AxiosRequestConfig): Promise<T>
    post<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T>
    put<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T>
    patch<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T>
    ws(url: string, options?: ClientRequestArgs): WebSocket
}

export namespace Quester {
    export interface Config {
        headers?: Dict
        endpoint?: string
        timeout?: number
        proxyAgent?: string
    }



    const agents: Dict<Agent> = {}

    function getAgent(url: string) {
        return agents[url] ||= new ProxyAgent(url)
    }

    export function create(config: Quester.Config = {}) {
        const { endpoint = '' } = config

        const options: AxiosRequestConfig = {
            timeout: config.timeout,
            headers: config.headers,
        }

        if (config.proxyAgent) {
            options.httpAgent = getAgent(config.proxyAgent)
            options.httpsAgent = getAgent(config.proxyAgent)
        }

        const request = async (url: string, config: AxiosRequestConfig = {}) => axios({
            ...options,
            ...config,
            url: endpoint + url,
            headers: {
                ...options.headers,
                ...config.headers,
            },
        })

        const http = (async (method, url, config) => {
            const response = await request(url, { ...config, method })
            return response.data
        }) as Quester

        http.config = config
        http.axios = request as any
        http.extend = (newConfig) => create({ ...config, ...newConfig })

        http.get = (url, config) => http('GET', url, config)
        http.delete = (url, config) => http('DELETE', url, config)
        http.post = (url, data, config) => http('POST', url, { ...config, data })
        http.put = (url, data, config) => http('PUT', url, { ...config, data })
        http.patch = (url, data, config) => http('PATCH', url, { ...config, data })
        http.head = async (url, config) => {
            const response = await request(url, { ...config, method: 'HEAD' })
            return response.headers
        }

        http.ws = (url, options = {}) => {
            return new WebSocket(url, {
                agent: getAgent(config.proxyAgent),
                handshakeTimeout: config.timeout,
                ...options,
                headers: {
                    ...config.headers,
                    ...options.headers,
                },
            })
        }

        return http
    }
}
