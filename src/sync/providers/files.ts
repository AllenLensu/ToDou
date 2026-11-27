import { newId } from '../../storage/transform'
import { t } from '../../i18n'
// 限定同步目录内的文本文件接口；具体网盘负责鉴权、目录约束和 HTTP 状态处理。
export interface RemoteFiles {
  list(): Promise<string[]>
  read(name: string): Promise<string | null>
  write(name: string, content: string): Promise<void>
  remove(name: string): Promise<void>
}

// 只接受单层文件名，不接收路径或 URL；这里只校验名称字符，协议版本由交换层判断。
export const validName = (name: string) => /^[a-z0-9][a-z0-9._-]{0,199}$/i.test(name)

export function fileName(name: string) {
  if (!validName(name)) throw new Error(t('同步文件名无效。'))
  return name
}

// 会创建、读回、列出并删除临时文件；只证明目录读写能力，不代表完整同步已验收。
export async function probeFiles(files: RemoteFiles) {
  const name = 'todou-probe-' + newId() + '.json'
  const contents = JSON.stringify({ test: 'ToDou 读写检查', nonce: newId() })
  await files.write(name, contents)
  try {
    if (await files.read(name) !== contents) throw new Error(t('网盘返回的测试文件内容与写入内容不同。'))
    if (!(await files.list()).includes(name)) throw new Error(t('网盘目录列表没有包含刚写入的测试文件。'))
  } catch (primaryError) {
    try {
      await files.remove(name)
    } catch (cleanupError) {
      if (primaryError instanceof Error && cleanupError instanceof Error) {
        throw new Error(t('{0} 临时文件清理也失败。{1}', primaryError.message, cleanupError.message), { cause: primaryError })
      }
    }
    throw primaryError
  }
  await files.remove(name)
}
