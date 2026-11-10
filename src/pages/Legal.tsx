import { A } from '@solidjs/router'
import { AccountBar } from '../AccountBar'

export function Terms() {
  return (
    <div class="subpage">
      <AccountBar />
      <main id="main-content" class="prose">
        <h1>用户协议</h1>
        <p>AI 几何画板提供自然语言驱动作图和计算。你可以用邮箱注册账号，把登录后的新会话保存到云端。</p>
        <p>请使用你本人的邮箱注册。密码至少 8 位，并请妥善保管。验证码只通过邮件发送，不要转给他人。</p>
        <p>作图命令由模型生成并在你的浏览器里交给 GeoGebra 执行。请自行核对结果，不要把本工具的输出当作考试、工程或法律依据。</p>
        <p>你可以随时导出自己的会话，或在设置中删除账号。删除后，你的会话、用量记录和个人供应商配置会一并删除。</p>
        <p><A href="/register">返回注册</A></p>
      </main>
    </div>
  )
}

export function Privacy() {
  return (
    <div class="subpage">
      <AccountBar />
      <main id="main-content" class="prose">
        <h1>隐私政策</h1>
        <p>注册时我们保存昵称、邮箱和密码哈希。验证码只出现在邮件里，服务器保存的是加盐后的哈希，用过或过期后失效。</p>
        <p>登录后的会话包含对话、输入草稿和作图报告。模型请求会记录模型名称、是否经过网关，以及上游返回的 token 数。浏览器不能自己上报这些数字。</p>
        <p>配置个人模型时，API Key 会加密保存在账号下。使用该模型时，服务端会把当前对话和作图请求发送给你选择的供应商。已保存的 Key 不会返回给浏览器。</p>
        <p>移除个人供应商会删除它保存的 Key。删除账号会一并移除关联的会话、用量记录和个人供应商配置。访客会话留在当前浏览器，之后登录也不会上传这些会话。清空本机缓存只删除本地草稿和界面偏好。</p>
        <p><A href="/register">返回注册</A></p>
      </main>
    </div>
  )
}
