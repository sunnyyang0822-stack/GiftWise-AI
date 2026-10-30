# GiftWise 最小 UHost 部署包

此目录只部署确定性规则 API，不包含 Dify 凭证、模型调用、前端或真实商品数据。

## 本地验证

```powershell
python deploy/server.py
Invoke-WebRequest http://127.0.0.1:8000/healthz
```

`POST /validate` 接收：

```json
{"request_json":"{...}","candidates_json":"{...}"}
```

API 复用 `validator/rules.py`，响应仍是既有校验结果；请求内容不写入日志。

## UCloud 控制台准备

1. 创建或选择 Linux UHost，并绑定公网 EIP。
2. 安全组允许管理来源访问 TCP 22；允许演示来源访问 TCP 8000。不要默认对全网开放管理端口。
3. 准备 SSH 私钥文件和实例用户名；不要把私钥、AccessKey 或 Secret 写入仓库。
4. 确认实例已安装 Docker。若镜像未安装，可在实例上按 UCloud 镜像文档安装后再执行脚本。

UCloud 文档：

- [创建云主机](https://docs.ucloud.cn/uhost/newuser/briefguide)
- [远程登录 Linux](https://docs.ucloud.cn/UCloudStack/userguide/mdToPdf/userguide.pdf)
- [安全组规则](https://docs.ucloud.cn/UCloudStack_v2.x/userguide/sg)

## 从 Windows 执行上传与启动

```powershell
.\deploy\publish-to-uhost.ps1 `
  -Host "公网IP" `
  -User "root" `
  -KeyPath "C:\path\to\private_key" `
  -ServicePort 8000
```

脚本只上传 `validator/rules.py`、`deploy/server.py` 和 `deploy/Dockerfile`，然后在 UHost 上构建并启动容器。完成后检查：

```powershell
Invoke-WebRequest http://公网IP:8000/healthz
```

当前脚本不能代替 UCloud 账号登录、实例创建、费用确认或安全组授权；这些必须在用户自己的控制台完成。
