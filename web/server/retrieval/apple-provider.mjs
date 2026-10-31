// 已停用：来源条款明确限制自动采集。保留类型供旧配置明确失败，不静默联网。
export class ApplePublicProvider {
 async search(){return {status:'unavailable',evidence_id:null,products:[],warnings:['Apple自动采集来源已停用：网站条款限制，需来源方许可或更换来源']};}
}
