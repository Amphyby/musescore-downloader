
/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable no-void */

import fs from 'fs'
import path from 'path'
import { fetchMscz, setMscz, MSCZ_URL_SYM } from './mscz'
import { loadMscore, INDV_DOWNLOADS, WebMscore } from './mscore'
import { ScoreInfo, ScoreInfoHtml, ScoreInfoObj } from './scoreinfo'
import { escapeFilename } from './utils'
import i18n from './i18n'

const inquirer: typeof import('inquirer') = require('inquirer')
const ora: typeof import('ora') = require('ora')
const chalk: typeof import('chalk') = require('chalk')

const SCORE_URL_PREFIX = 'https://musescore.com/'
const EXT = '.mscz'

interface Params {
  url: string;
  confirmed: boolean;
  part: number;
  types: number[];
  dest: string;
}

void (async () => {
  const fileInit: string | undefined = process.argv[2]
  const isLocalFile = fileInit?.endsWith(EXT) && fs.existsSync(fileInit)

  let scoreinfo: ScoreInfo
  if (!isLocalFile) {
    // ask for the page url
    const { url } = await inquirer.prompt<Params>({
      type: 'input',
      name: 'url',
      message: 'Score URL:',
      suffix: ` (starts with "${SCORE_URL_PREFIX}")\n `,
      validate (input: string) {
        return input && input.startsWith(SCORE_URL_PREFIX)
      },
      default: fileInit,
    })

    // request scoreinfo
    scoreinfo = await ScoreInfoHtml.request(url)

    // confirmation
    const { confirmed } = await inquirer.prompt<Params>({
      type: 'confirm',
      name: 'confirmed',
      message: 'Continue?',
      prefix: `${chalk.yellow('!')} ` +
        `ID: ${scoreinfo.id}\n  ` +
        `Title: ${scoreinfo.title}\n `,
      default: true,
    })
    if (!confirmed) return
    console.log() // print a blank line to the terminal
  } else {
    scoreinfo = new ScoreInfoObj(0, path.basename(fileInit, EXT))
  }

  const spinner = ora({
    text: i18n('PROCESSING')(),
    color: 'blue',
    spinner: 'bounce',
    indent: 0,
  }).start()

  let score: WebMscore
  let metadata: import('webmscore/schemas').ScoreMetadata
  try {
    if (!isLocalFile) {
      // fetch mscz file from the dataset, and cache it for side effect
      await fetchMscz(scoreinfo)
    } else {
      // load local file
      const data = await fs.promises.readFile(fileInit)
      await setMscz(scoreinfo, data.buffer)
    }

    spinner.info('MSCZ file loaded')
    if (!isLocalFile) {
      spinner.info(`File URL: ${scoreinfo.store.get(MSCZ_URL_SYM) as string}`)
    }
    spinner.start()

    // load score using webmscore
    score = await loadMscore(scoreinfo)
    metadata = await score.metadata()

    spinner.info('Score loaded by webmscore')
  } catch (err) {
    spinner.fail(err.message)
    return
  }
  spinner.succeed('OK\n')

  // build part choices
  const partChoices = metadata.excerpts.map(p => ({ name: p.title, value: p.id }))
  // add the "full score" option as a "part" 
  partChoices.unshift({ value: -1, name: i18n('FULL_SCORE')() })
  // build filetype choices
  const typeChoices = INDV_DOWNLOADS.map((d, i) => ({ name: d.name, value: i }))

  // part selection
  const { part } = await inquirer.prompt<Params>({
    type: 'list',
    name: 'part',
    message: 'Part Selection',
    choices: partChoices,
  })
  const partName = partChoices[part + 1].name
  await score.setExcerptId(part)

  // filetype selection
  const { types } = await inquirer.prompt<Params>({
    type: 'checkbox',
    name: 'types',
    message: 'Filetype Selection',
    choices: typeChoices,
    validate (input: number[]) {
      return input.length >= 1
    },
  })
  const filetypes = types.map(i => INDV_DOWNLOADS[i])

  // destination directory
  const { dest } = await inquirer.prompt<Params>({
    type: 'input',
    name: 'dest',
    message: 'Destination Directory:',
    validate (input: string) {
      return input && fs.statSync(input).isDirectory()
    },
    default: process.cwd(),
  })

  // export files
  const fileName = scoreinfo.fileName || await score.titleFilenameSafe()
  spinner.start()
  await Promise.all(
    filetypes.map(async (d) => {
      const data = await d.action(score)
      const n = `${fileName} - ${escapeFilename(partName)}.${d.fileExt}`
      const f = path.join(dest, n)
      await fs.promises.writeFile(f, data)
      spinner.info(`Saved ${chalk.underline(f)}`)
      spinner.start()
    }),
  )
  spinner.succeed('OK')
})()