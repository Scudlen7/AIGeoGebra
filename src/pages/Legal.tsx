import { A } from '@solidjs/router'
import { AccountBar } from '../AccountBar'

export function Terms() {
  return (
    <div class="subpage">
      <AccountBar />
      <main class="prose">
        <h1>用户协议</h1>
        <p>AI 几何画板提供自然语言驱动作图和计算。你可以用邮箱注册账号，把登录后的新会话保存到云端。</p>
        <p>请使用你本人的邮箱注册。密码至少 8 位，并请妥善保管。验证码只通过邮件发送，不要转给他人。</p>
        <p>作图命令由模型生成并在你的浏览器里交给 GeoGebra 执行。请自行核对结果，不要把本工具的输出当作考试、工程或法律依据。</p>
        <p>你可以随时导出自己的会话，或在设置中删除账号。删除后，你的会话和用量记录会一并删除。</p>
        <p><A href="/register">返回注册</A></p>
      </main>
    </div>
  )
}

export function Privacy() {
  return (
    <div class="subpage">
      <AccountBar />
      <main class="prose">
        <h1>隐私政策</h1>
        <p>注册时我们保存昵称、邮箱和密码哈希。验证码只出现在邮件里，服务器保存的是加盐后的哈希，用过或过期后失效。</p>
        <p>登录后的会话包含对话、输入草稿和作图报告。模型请求会记录模型名称、是否经过网关，以及上游返回的 token 数。浏览器不能自己上报这些数字。</p>
        <p>模型密钥只放在服务端环境变量中，页面不能查看、复制或重置。未登录时的本地会话留在这台浏览器里，不会因为后来登录就被上传。</p>
        <p>删除账号时，关联的会话和用量记录会一起删除。清空本机缓存只删除以 aiggb. 开头的本地数据，不会退出登录，也不会删除云端记录。</p>
        <p><A href="/register">返回注册</A></p>
      </main>
    </div>
  )
}
