"""QA 自建虚构输入；scenario 是测试描述，不是提议中的业务请求字段。"""
import json
from pathlib import Path

HERE=Path(__file__).resolve().parent
CASES=[]
def add(group,title,scenario,expected,layer='controlled',alignment=None):
    CASES.append(dict(id=f'{group}-{1+sum(c["group"]==group for c in CASES):02}',
        group=group,title=title,scenario=scenario,expected=expected,layer=layer,
        prerequisite=('PM锁定SHA、独立副本、契约映射确认；'+
            {'controlled':'交付可注入provider及可观察轨迹','http':'交付HTTP入口与独占端口',
             'browser':'交付普通URL前端及独立Chromium','real_retrieval':'后台专用浏览器已连接、允许的公开来源',
             'image_service':'另行授权图像服务及参考图能力'}[layer]),
        alignment=alignment or [],evidence=['输入与实际响应','预期逐项对照','调用/任务轨迹或截图'],
        status='BLOCKED',reason='准备阶段，等待实现交付与PM锁定集成SHA'))

add('R','后台已连接',{'browser':'connected','query':'白底笔记本 CNY 200'},'记录专用浏览器实际检索/详情与时间，不能只看doctor成功','real_retrieval')
add('R','后台未连接',{'browser':'disconnected'},'明确unavailable或契约定义失败；不伪造browser_observed，不阻塞已有文本降级')
add('R','超时',{'provider':'never_resolves'},'按交付超时终止/隔离；后续任务不与遗留执行并发；无成功商品',alignment=['A01'])
add('R','验证码',{'page':'captcha'},'停止检索、明确维护者处理；不绕过、不让用户提供个人Cookie')
add('R','访问限制',{'page':'403/429/登录限制'},'如实失败/受限；不把空提取当成功、不自动绕过')
add('R','无插件普通用户',{'profile':'全新普通浏览器，无扩展'},'仅网站可完成提交，用户不安装插件，不读取用户浏览器会话','browser')
add('R','不弹搜索窗口',{'observe':'window.open/新target/网络'},'只访问业务API；用户无搜索新窗口或直连桥接/调试端口','browser')
add('R','检索词最小披露',{'fixture':'private_input'},'捕获worker发出的真实查询，仅必要品类/预算/非敏感偏好；所有私密哨兵及完整原文均不外发')
add('R','双任务隔离',{'tasks':['A-红色笔记本','B-蓝色水杯'],'sequence':'A慢、B随后、轮询交错'},'A/B商品、证据、图片和状态均不串用；ID不能跨任务引用','http',['A01'])
add('R','队列满',{'occupy':'worker+恰好Q个等待，再提交1个'},'边界前接纳、边界后明确拒绝/排队状态；不静默丢任务','http',['A01'])
add('R','取消等待任务',{'cancel':'queued task then release active'},'取消后不启动provider，状态明确且可查','http',['A01'])
add('R','取消运行任务',{'cancel':'running then late callback'},'不接受迟到结果、不污染新任务；重复取消有明确结果','http',['A01'])
add('R','拒绝shell和脚本',{'fixture':'unsafe_search'},'仅允许结构化受限参数；拒绝shell/eval/script/命令拼接，provider调用数=0')
add('R','拒绝内网URL',{'fixture':'unsafe_urls'},'协议/DNS/IP/重定向每跳检查；内网/回环/元数据均拒绝，无探测真实内网')
add('R','公共下载限制',{'fixture':'unsafe_media'},'默认不执行SVG/HTML；拒绝超大、伪MIME、签名错、超时；不向前端暴露Key/调试端口')

add('P','SKU规格数量来源绑定',{'products':['p-notebook','p-cup','p-book'],'mutations':['换SKU','换规格','数量1改2','换来源证据']},'逐项匹配来源记录；不匹配引用拒绝，不能只看同名商品')
add('P','普通价',{'fixture':'ordinary'},'只用对应规格数量的普通价并显示观察时间/来源；不承诺结算价')
add('P','会员价',{'fixture':'member'},'无会员条件确认不能把会员价当所有用户可购买价；条件明确可见',alignment=['A02'])
add('P','券价',{'fixture':'coupon'},'不自动假定用户有券或券仍有效；条件不明不可标预算已核实',alignment=['A02'])
add('P','多件价',{'fixture':'multi'},'数量和门槛一致；两件总价不能误用作单件价/反之',alignment=['A02'])
add('P','无价格',{'fixture':'no_price'},'price_amount=null、未知价；不填0、不标预算已核实通过')
add('P','区间跨预算',{'fixture':'cross_range','budget_max':'200.00'},'按上端保守筛选/不确定，不取区间低值强行通过')
add('P','价格过期',{'fixture':'stale'},'标过期/重新检索或不确定；不得当当前已核实价',alignment=['A03'])
add('P','币种不符',{'fixture':'wrong_currency'},'GBP来源不冒充CNY，不静默换汇，不标预算通过')
add('P','模型改低引用价',{'server_price':'200.01','model_claim':'199.99','budget_max':'200.00'},'服务端取冻结价格并拒绝改价；模型不能用低价绕过')
add('P','有据商品不足三个',{'evidence_count':[0,1,2]},'明确partial/不足/澄清，保留证据；不复制商品或生成假记录凑3项')
add('P','恰等上限',{'fixture':'ordinary','budget_max':'200.00'},'同SKU数量普通价200.00符合上限；不能将not_verified改成全面核实')
add('P','超出一分钱',{'fixture':'one_cent_over','budget_max':'200.00'},'200.01超预算不可选，十进制定点比较无浮点误差')
add('P','seed与用户报价分开',{'sources':['seed','user_provided','browser_observed','unknown']},'保留各自来源标识；seed是估算非实时，用户报价不是后台实读')
add('P','事实推断未知分离',{'relation':'pursuit','known':'喜欢阅读','inference':'可能喜欢设计','unknown':'材质安全未知'},'不将模型猜测/图片推断写成用户事实；追求对象无双向好感假设')
add('P','硬排除仍拦截',{'forbidden':'fragrance','quoted_product_tag':'fragrance'},'有价格/图片不豁免硬排除，候选不可选')
add('P','全局一次修订',{'repair_count':1,'presentation_invalid':True},'不再修订；检索/媒体任务不能重置业务额度或伪装重试绕过')
add('P','预算账单不相加',{'selected':'c2','candidate_prices':['200.00','120.00','80.00']},'礼物账单仅c2=120.00，包装不报价；图像服务费用不冒充礼物价格')

add('M','三候选图正确绑定',{'bindings':[['c1','p-notebook','im1'],['c2','p-cup','im2'],['c3','p-book','im3']]},'乱序返回仍按candidate/product/image引用绑定，不按数组位置混配','browser')
add('M','错任务或过期图片引用',{'reference':['unknown','other_task','expired']},'可信服务端拒绝，不显示其他任务图片',alignment=['A03'])
add('M','来源照片标识',{'kind':'source_photo'},'SKU/规格、来源、使用依据可追溯；公开可见不自动称有转载授权','browser')
add('M','AI图标识',{'kind':'ai_illustration'},'明确“AI效果示意，非商品实拍”；不能宣称是SKU实拍','browser')
add('M','开发样例标识',{'kind':'demo'},'样例标识可见且不冒充对应商品','browser')
add('M','缺图降级',{'image':None},'文字三方案/理由/价格不丢失，缺图状态明确，非假图片地址','browser')
add('M','加载图片失败',{'image_response':['404','超时','解码失败']},'有错误/重试或降级提示，文字与选择仍可用，非生成成功','browser')
add('M','不能图证安全',{'claims':['图片证明材质','图片保证无过敏','图片证明价格']},'保留未知与风险提示，不用图片作为价格/成分/过敏安全证据')
add('M','未选择不生成',{'selected':None},'包装provider调用0；不默认选择第一项','http',['A01'])
add('M','不合格不可生成',{'selected':'未通过候选','client_passed':True},'服务端可信状态拒绝，包装provider调用0，篡改passed无效','http',['A01'])
add('M','重复选择幂等',{'selected':'c2','requests':'并发两次+重放'},'仅创建一次生成任务；相同引用/结果可观察，不重复计费','http',['A01'])
add('M','provider未配置',{'provider':'unconfigured'},'unavailable且保留文字包装/贺卡，不调用付费服务')
add('M','provider失败',{'provider':['timeout','error','invalid_image']},'failed/unavailable准确呈现；不改变合格礼物选择或价格')
add('M','参考图能力',{'service':'支持或不支持参考图'},'真实授权后核对选中外观/色彩规格；不支持参考图不能承诺一致','image_service')
add('M','坐标边界合法',{'fixture':'valid_annotations'},'target/label x/y含0、1合法；有简短中文及文字等价')
add('M','坐标非法',{'fixture':'invalid_annotations'},'负数、>1、NaN/Infinity、字符串/布尔/缺字段均拒绝或明确降级，不崩溃')
add('M','桌面箭头定位',{'viewport':'1440x900','image_fit':'contain'},'坐标相对实际图片内容区，指向贺卡/色带，留白不造成偏移','browser')
add('M','390窄屏定位',{'viewport':'390x844','orientation':'portrait'},'无横溢出，标签不遮盖关键主体，目标随图片缩放一致','browser')
add('M','缩放定位',{'zoom':['100%','200%'],'resize':'desktop→390'},'放大/缩小时重新定位且可查看完整包装图；坐标不依赖固定像素','browser')
add('M','中文键盘与等价文字',{'actions':['Tab','Enter','Escape'],'text':'valid_annotations'},'焦点可见，放大/关闭可键盘操作；中文可读，alt与完整标注文字可访问','browser')

add('F','取消预算重复确认',{'budget':'当前合法可见区间','interact':'不拖动、不额外勾选'},'无额外预算确认框或budget_confirmed门禁，合法输入可直接下一步；AI排除确认仍保留','browser')
add('F','预算不确定',{'budget_mode':'不确定'},'阻止继续并给中文补充提示，不能补默认金额','browser')
add('F','非法预算',{'values':['','-1','NaN','Infinity','true','01','10000.01'],'range':'min>max'},'缺失/格式/倒置/上限错误均阻止继续，不因删除确认而放宽','browser')
add('F','避免项placeholder',{'expected_placeholder':'讨厌的东西，过敏，衣服尺码未知'},'“需要避免的”实际placeholder逐字一致','browser')
add('F','送礼历史选填为空',{'previous_gifts':''},'留空不阻断，不自动生成硬禁忌','browser',['A04'])
add('F','送礼历史不成硬禁忌',{'previous_gifts':'去年送过一本虚构笔记本'},'只作为可选历史/比较信息，不无据写入硬性排除；明确禁忌仍单独确认','http',['A04'])
add('F','其他关系输入',{'relation':'other','custom':['','虚构社团伙伴']},'显示输入，空值阻止，有效非空保持原文并能继续','browser')
add('F','其他场合输入',{'occasion':'other','custom':['','虚构搬家答谢']},'显示输入，必填及有效提交正常','browser')
add('F','其他金额输入',{'amounts':[['0','0'],['0.99','200.00'],['200.01','200.00']]},'显示上下限输入；零/小数合法、倒置拒绝，无额外确认','browser')
add('F','隐私与条款',{'actions':['鼠标','键盘','返回表单']},'入口可用、中文可读、可返回且不丢输入；不跳到假地址','browser')

def assets():
    products=[]
    for pid,name,variant,price,im in [('p-notebook','虚构留白笔记本','A5米白/1本','200.00','im1'),('p-cup','虚构蓝色杯','300ml蓝色/1只','120.00','im2'),('p-book','虚构图文册','平装/1册','80.00','im3')]:
        products.append(dict(product_id=pid,name=name,variant=variant,quantity=1,price_amount=price,
            currency='CNY',price_conditions=[],price_source='seed',source_url=None,observed_at=None,
            image_id=im,price_range=None,shipping_status='unknown',stock_status='unknown',evidence_ref=None))
    prices={}
    for key,overrides in dict(ordinary={'price_amount':'200.00'},one_cent_over={'price_amount':'200.01'},
        member={'price_amount':'169.00','price_conditions':['需会员']},coupon={'price_amount':'159.00','price_conditions':['需满减券，资格未知']},
        multi={'quantity':2,'price_amount':'300.00','price_conditions':['两件合计价，非单件价']},
        no_price={'price_amount':None,'price_source':'unknown'},cross_range={'price_amount':None,'price_range':{'min':'180.00','max':'220.00'}},
        stale={'observed_at':'2000-01-01T00:00:00Z'},wrong_currency={'currency':'GBP','price_amount':'51.77'}).items():
        prices[key]={**products[0],**overrides}
    annotations=[{'id':'qa-a1','text':'米白色带','target':{'x':0,'y':1},'label':{'x':1,'y':0}},
                 {'id':'qa-a2','text':'贺卡放在礼物前侧','target':{'x':.5,'y':.75},'label':{'x':.2,'y':.3}}]
    return dict(notice='全为QA虚构数据。不是商品证据、API请求或真实图片；不得发起网络/付费调用。',
        products=products,prices=prices,valid_annotations=annotations,
        invalid_annotations=[{'field':f,'value':v} for f in ['target.x','target.y','label.x','label.y'] for v in [-.01,1.01,'NaN','Infinity','0.5',True,None]],
        nonfinite_transport_cases=['原始JSON NaN','原始JSON Infinity','内存float(nan)','内存float(inf)'],
        private_input={'raw':'虚构姓名小岚 QA_NAME_59，电话 QA_PHONE_59，追求对象私事 QA_REL_59，过敏详情 QA_ALLERGY_59，地址 QA_ADDR_59。想找笔记本，预算200元。',
                       'must_not_leave':['QA_NAME_59','QA_PHONE_59','QA_REL_59','QA_ALLERGY_59','QA_ADDR_59']},
        unsafe_search=['; echo QA_COMMAND_SENTINEL','$(echo QA_COMMAND_SENTINEL)','eval("QA")','javascript:alert(1)','<script>QA</script>'],
        unsafe_urls=['http://127.0.0.1/','http://[::1]/','http://10.0.0.1/','http://169.254.169.254/','file:///QA','javascript:QA','https://public.example.invalid/redirect-to-private','https://rebind.example.invalid/'],
        unsafe_media=['image/svg+xml含脚本','HTML伪装PNG','MIME与签名不符','超过交付字节上限','永不结束响应'],
        media={'status':'ready','candidates':[dict(candidate_id=f'c{n}',product_id=p['product_id'],image=dict(id=f'im{n}',url=f'https://qa-assets.example.invalid/{n}.png',kind='demo',alt='开发样例，非对应商品实拍',source_url=None,attribution='QA虚构占位，禁止网络加载')) for n,p in enumerate(products,1)],'selected':None})

if __name__=='__main__':
    (HERE/'matrix.json').write_text(json.dumps(CASES,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    (HERE/'fixtures.json').write_text(json.dumps(assets(),ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
