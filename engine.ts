

const axios = require('axios')
const parser = require('cheerio')

const fileManager = require('fs')
const terminalPrompt = require("prompt-sync")()

interface UrlRelationship {
  fatherUrl: string,
  childUrl: string,
  alike: boolean,
  title: string
}

interface UrlScheme {
  uniqueUrls: [string],
  relationships: UrlRelationship[]
}

interface UrlResource {
  subject: string,
  url: string,
  body: string
}

interface UrlStatistic {
  urlSubject: string,
  calls: UrlRelationship[],
  callsLength: number
}

interface UrlReferenceReport {
  term: string,
  calls: number,
  callScore: number,
  callWhere: string[] // callWhere: stats[i].calls.map(i => i.title)
  searchedWordEncounters: number,
  selfReferenceHistory: boolean[]
}

interface KeywordQueryObject {
  'Local': string,
  'Qtd.': number,
  'Pontos': number
}

interface UrlTableData {
  'Página': string,
  'Pts': number,
  'Chamadas': number[],
  'Nº busca': number[],
  'Auto ref': number,
  'Páginas': string
}

interface Wipe {
  wipe(): void
}

class Crawler implements Wipe {
  public crawlReport: UrlScheme | undefined
  public uniqueUrls: [string] | undefined
  public relationships: UrlRelationship[] | undefined
  public uniqueUrlsResources: UrlResource[] | undefined
  public eachUrlStatistics: UrlStatistic[] | undefined

  wipe(): void {
    this.crawlReport = undefined
    this.uniqueUrls = undefined
    this.relationships = undefined
    this.uniqueUrlsResources = undefined
    this.eachUrlStatistics = undefined
  }

  async getUrlResource(url: string, resourceName: string): Promise<string | undefined> {
    try {
      const res = await axios.get(url)
      const $ = parser.load(res.data)
      
      if(resourceName === 'title') {
        return $('title').text()
      } 

      else if(resourceName === 'style') {
        return $('style').text()
      } 

      // return $('body').html()
      return $('html').html()

    } catch(err) {
      console.log('Algum erro', err)
      return undefined
    }
  }
  
  async pushResource(uniqueUrls: [string]): Promise<UrlResource[]> {
    const resources: UrlResource[] = []
    
    for(const url of uniqueUrls) {
      const subject = await this.getUrlResource(url, 'title')
      const currentUrl = url
      const body = await this.getUrlResource(url, '')

      if (subject && body) {
        resources.push({subject: subject, url: currentUrl, body: body})
      }
    }

    return resources
  }

  pushReference(resourcesReport: UrlResource[], relationshipReport: UrlRelationship[]): UrlStatistic[] {
    const statistics: UrlStatistic[] = []
    
    for(const i of resourcesReport) {
      const urlCalls = relationshipReport.filter(i2 => i2.childUrl === i.url)
      
      statistics.push(
        {
          urlSubject: i.subject,
          calls: urlCalls,
          callsLength: urlCalls.length,
        }
      )
    }
    return statistics
  }
  
  async crawl(originUrl: string): Promise<UrlScheme> {
    const visitedUrls: Set<String> = new Set();
    const queueUrls: string[] = [originUrl]
    const uniqueUrls: Set<string> = new Set([originUrl])
    const relationships: UrlRelationship[] = []
    
    while (queueUrls.length > 0) {
      
      const currentUrl = queueUrls.shift()

      if (!currentUrl || visitedUrls.has(currentUrl)) {
        continue
      }
      
      try {
        visitedUrls.add(currentUrl)

        const res = await axios.get(currentUrl)
        const $ = parser.load(res.data)
        const urlsWithin: string[] = []
        
        $('a').each((pos: number, tag: Element) => {
          const urlHref = $(tag).attr('href')
          
          relationships.push(
            {
              fatherUrl: currentUrl,
              childUrl: urlHref,
              alike: currentUrl === urlHref,
              title: $('title').text()
            }
          )
          
          if (urlHref) {
            const cleanLink = new URL(urlHref, currentUrl).href
            urlsWithin.push(cleanLink)
          }
        })
    
        for (const link of urlsWithin) {
          if (!uniqueUrls.has(link)) {
            uniqueUrls.add(link)
            queueUrls.push(link)
          }
        }

      } catch(err) {
        console.log('Algum erro', err)
      }
    }

    return {
      uniqueUrls: Array.from(uniqueUrls) as [string],
      relationships: Array.from(relationships)
    }
  }

  async fetchData(originUrl: string): Promise<void> {
    this.crawlReport = await this.crawl(originUrl)
    this.uniqueUrls = [...this.crawlReport.uniqueUrls]
    this.relationships = [...this.crawlReport.relationships]  // fatherUrl, childUrl, alike, title
    this.uniqueUrlsResources = await this.pushResource(this.uniqueUrls)
    this.eachUrlStatistics = this.pushReference(this.uniqueUrlsResources, this.relationships)
  }
}

class FileSystem {
  appendDown(fileName: string, content: string): void {
    // fileManager.appendFileSync(fileName, JSON.stringify(content), 'utf-8', err => {console.log(err)})
    fileManager.appendFileSync(fileName, content, 'utf-8', (err: any) => {console.log(err)})
  }

  doesFileExist(route: string): boolean {
    try {
      fileManager.accessSync(route, fileManager.constants.F_OK);
      return true // it exists
    } catch (err) {
      return false // it does not
    }
  }

  readTxt(route: string): string {
    return fileManager.readFileSync(route, 'utf-8')  
  }

  startFile(fileName: string): void {
    fileManager.writeFileSync(fileName, '', 'utf-8')
  }
}

class Rank implements Wipe {
  public authScore: number
  public wordFound: number
  public selfRefPenalty: number
  private rank: UrlReferenceReport[]

  private crawlerInstance: Crawler

  constructor(crawlerInstance: Crawler) {
    this.authScore = 10
    this.wordFound = 5
    this.selfRefPenalty = -15

    this.crawlerInstance = crawlerInstance

    this.rank = []
  }

  calculateAuthority(currentUrl: UrlStatistic, relationships: UrlRelationship[]): number {
    let calculus: number = 0

    if (this.crawlerInstance.eachUrlStatistics) {
      calculus = currentUrl.callsLength * this.authScore
    }
    
    for(const url of relationships) {
      // if self reference was found 
      if(url.title === currentUrl.urlSubject && url.alike) {
        // remove the score given to the url previously, because there was self reference
        calculus -= this.authScore
        // then give negative score as punishment for self reference
        calculus += this.selfRefPenalty
      }
    }

    return calculus
  }

  addAuthorityPoints(stats: UrlStatistic[], relationships: UrlRelationship[]): void {
    for(let i = 0; i < stats.length; i++) {
      // data for procedures of calculus
      this.rank.push(
        {
          term: stats[i].urlSubject,
          calls: stats[i].callsLength,
          callScore: this.calculateAuthority(stats[i], relationships), // penalty if self references
          callWhere: stats[i].calls.map(i => i.title),
          // set with standard values in this momment, updated after calling 'addQueryPoints'
          searchedWordEncounters: 0,
          selfReferenceHistory: []
        }
      )
    }
  }

  addQueryPoints(queryArray: KeywordQueryObject[]): void {
    for(const i of this.rank) {
      const timesFound = queryArray.filter(j => j['Local'].trim() === i.term.trim())[0]['Pontos']
      i.callScore += timesFound
      i.searchedWordEncounters = queryArray.filter(j => j['Local'] === i.term)[0]['Qtd.']
    }
  }

  addSelfReferenceArray(reference: UrlRelationship[]) {
    for(let i = 0; i < this.rank.length; i++) {
      this.rank[i].selfReferenceHistory = reference.filter(
        history => history.title === this.rank[i].term)
        .filter(history => history.alike).map(history => history.alike)
    }
  }

  reduceCallFromSelfReference(): void {
    for(const urlField of this.rank) {
      if(urlField.selfReferenceHistory.length !== 0) {
        // reduce calls based on the 'true' amount inside 'selfReferenceHistory'
        urlField.calls -= urlField.selfReferenceHistory.filter(i => i === true).length
      }
    }
  }

  initGroupSort() {
    this.rank.sort((a, b) => {
      const biggerScoreInFront = b.callScore - a.callScore
      const mostLinkCallsInFront = b.calls - a.calls
      const largerQueryResultInFront = b.searchedWordEncounters - a.searchedWordEncounters
      const noSelfReferenceInFront = (a.selfReferenceHistory || []).length - (b.selfReferenceHistory || []).length 
      
      if(b.callScore !== a.callScore) return biggerScoreInFront
      if(a.calls !== b.calls) return mostLinkCallsInFront
      if(a.searchedWordEncounters !== b.searchedWordEncounters) return largerQueryResultInFront
      
      return noSelfReferenceInFront
    })
  }

  show(): UrlTableData[] {
    let pos = 1
    const positions: UrlTableData[] = []

    for(const i of this.rank) {
      positions.push(
        {
          'Página': i.term.length > 10 ? `${pos}º ${i.term.substring(0, 10)}...` : `${pos}º ${i.term}`,
          'Pts': i.callScore, 
          'Chamadas': [i.calls, i.calls * this.authScore], 
          'Nº busca': [i.searchedWordEncounters, this.wordFound * i.searchedWordEncounters],
          'Auto ref': i.selfReferenceHistory.length * this.selfRefPenalty,
          'Páginas': i.callWhere.map(pageName => pageName.length > 5 ? `${pageName.substring(0, 5)}...` : pageName).join(' | ')
        }
      )
        
      pos++
    }
    
    return positions
  }

  wipe(): void {
    this.rank = []
  }

}

class Searcher {
  find(fileString: string[], keyword: string, scoreGiven: number): KeywordQueryObject[] {
    const container: KeywordQueryObject[] = []

    for(let i = 0; i < fileString.length; i++) {
      // console.log('--------------------------------------------------o', fileString[i])
      const isIndiceBody: boolean = fileString[i][0] === '<'
      
      if(isIndiceBody) {
        const getWordEncounters: number = fileString[i].split(keyword).length - 1
  
        // Make data structure about it
        container.push(
          {
            'Local': fileString[i - 1].replace('!@', '').trim(),
            'Qtd.': getWordEncounters,
            'Pontos': getWordEncounters * scoreGiven
          }
        )
      }
    }
  
    container.sort((a, b) => b['Qtd.'] - a['Qtd.'])
    
    return container
  }
}

class TerminalProgram implements Wipe {
  private banner: string
  protected msg
  protected engine: boolean
  protected keyTerms: string[]
  protected keyword: string | null
  protected originUrl: string | null
  
  protected crawlerInstance: Crawler
  protected fileSystemInstance: FileSystem
  protected rankInstance: Rank
  protected searcherInstance: Searcher
  protected urlReferenceReport: UrlReferenceReport[] | undefined

  constructor(crawlerInstance: Crawler, fileSystemInstance: FileSystem, searcherInstance: Searcher, rankInstance: Rank) {
    this.banner = '========== AVISO ==========\n'
    this.engine = true
    this.keyTerms = 'matrix.ficção científica.realidade.universo.viagem'.split('.')
    this.keyword = ''
    this.msg = {
      bye: `${this.banner} Programa encerrado. Até uma próxima!`,
      outOfRange: `${this.banner}Opção escolhida está fora do intervalo: 0 ao 2!`,
      typeDynamicUrl: 'Digite a url dinâmica',
      pressEnter: '>>> APERTE ENTER p/ continuar <<<',
      urlChanged: `${this.banner}Url foi modificada`
    }
    this.originUrl = 'https://lucasfarias072.github.io/mock-web-page-blade-runner/'
    // this.originUrl = 'https://lucasfarias072.github.io/mock-web-page-gravidade/'

    this.crawlerInstance = crawlerInstance
    this.fileSystemInstance = fileSystemInstance
    this.searcherInstance = searcherInstance
    this.rankInstance = rankInstance
    
    // this.neededData
  }

  startMenu(): string {
    return `
    ========== BUSCADOR ==========
    OPÇÕES
    0 - encerrar programa
    1 - fazer crawl com url padrão
    2 - fazer crawl com url padrão + termos chave
    3 - mudar url padrão
    4 - ver url padrão atual
    
    --o Informe a opção`
  }

  showKeyTerms(): string {
    return `
    ======= TERMOS CHAVE =======
    Escolha um dos termos chave
    ${this.keyTerms.map((term, pos) => `${pos + 1}. ${term}`).join(' || ')}
    
    --o Escolha uma das palavras fixas pelo número`
  }

  changeUrl(): void {
    console.log(this.msg.typeDynamicUrl)
    const originUrl = terminalPrompt('>> ')
    this.originUrl = originUrl
    this.fileSystemInstance.startFile('./bodies.txt')
    console.log(this.msg.urlChanged)
    terminalPrompt(this.msg.pressEnter)
  }

  treatInput(inputValue: string): boolean {
    return this.keyTerms.includes(inputValue) ? true : false
  }

  obtainData(arbitraryKeyword: string, userFriendly=true): void {
    this.fileSystemInstance.startFile('./bodies.txt')
    
    const fileLength = fileManager.statSync('./bodies.txt').size

    // Populate body from all unique urls if empty
    if(!this.fileSystemInstance.doesFileExist('./bodies.txt') || fileLength === 0) {
      if (this.crawlerInstance.uniqueUrlsResources) {
        for(const data of this.crawlerInstance.uniqueUrlsResources) {
          const newContent = `^!@${data.subject} ^${data.body.split('\n').join(' ').toLowerCase().trim()}`
          this.fileSystemInstance.appendDown('./bodies.txt', newContent)
        }
      }
    } 
    
    // Access body from all unique urls 
    const bodiesArray = this.fileSystemInstance.readTxt('./bodies.txt').split('^')

    // ===== ALGORITHM: Find how many calls a keyword has =====
    if (userFriendly) {
      this.keyword = terminalPrompt('Por favor, informe a palavra-chave >> ')
      if (this.keyword === 'ficcao cientifica') {
        this.keyword = 'ficção científica'
      }
    }
    else {
      this.keyword = this.keyTerms[parseInt(arbitraryKeyword) - 1]
    }
    
    let wordSearchHistory: KeywordQueryObject[] = []
    
    if(this.keyword) {
      wordSearchHistory = this.searcherInstance.find(bodiesArray, this.keyword, this.rankInstance.wordFound)
      const wordName = userFriendly ? this.keyword.toUpperCase() : this.keyTerms[parseInt(arbitraryKeyword) - 1]
      console.log(`===== Ocorrências da palavra: ${wordName} =====`)
      console.table(wordSearchHistory)
      terminalPrompt(this.msg.pressEnter)
    }
    
    if (this.crawlerInstance.eachUrlStatistics && this.crawlerInstance.relationships) {
      this.rankInstance.addAuthorityPoints(
        this.crawlerInstance.eachUrlStatistics, 
        this.crawlerInstance.relationships
      )
    }
    
    if(this.crawlerInstance.relationships) {
      // sum current authority with query
      this.rankInstance.addQueryPoints(wordSearchHistory)

      // add self reference attribute as draw criteria
      this.rankInstance.addSelfReferenceArray(this.crawlerInstance.relationships)

      // decrement calls from url calling themselves
      this.rankInstance.reduceCallFromSelfReference()
    }
    
    // sort by 4 criteria: total score, times referenced, query results from word, self reference
    this.rankInstance.initGroupSort()

    const ultimateRank: UrlTableData[] = this.rankInstance.show()
    
    console.table(ultimateRank)
  }

  obtainDataArbitrary(): void {
    console.log(this.showKeyTerms())
    const arbitraryKeyword = terminalPrompt('>> ')
    let termAssertion
    if (arbitraryKeyword) {
      termAssertion = this.treatInput(this.keyTerms[parseInt(arbitraryKeyword) - 1])
    }
    if(termAssertion && arbitraryKeyword) {
      this.obtainData(arbitraryKeyword, false)
    } else {
      this.obtainDataArbitrary()
    }
  }

  wipe(): void {
    this.keyword = ''
  }

  async init(): Promise<void> {
    while (this.engine) {
      this.crawlerInstance.wipe()
      this.rankInstance.wipe()
      if (this.originUrl) await this.crawlerInstance.fetchData(this.originUrl)
      
      console.clear()
      console.log(this.startMenu())
      const starterUrl = terminalPrompt('>> ')
      
      switch (starterUrl) {
        case '0':
          console.log(this.msg.bye)
          this.engine = false
          break
        case '1':
          this.obtainData('')
          terminalPrompt(this.msg.pressEnter)
          break
        case '2':
          this.obtainDataArbitrary()
          terminalPrompt(this.msg.pressEnter)
          break
        case '3':
          this.changeUrl()
          break
        case '4':
          console.log(`===== AVISO: url padrão atual =====\n${this.originUrl}\n`)
          terminalPrompt(this.msg.pressEnter)
          break
        default:
          console.log(this.msg.outOfRange)
          terminalPrompt(this.msg.pressEnter)
      }
    }
  }

}

(async function() {
  const crawler: Crawler = new Crawler()
  const fileSystem: FileSystem = new FileSystem()
  const searcher: Searcher = new Searcher()
  const rank: Rank = new Rank(crawler)
  const terminal = new TerminalProgram(crawler, fileSystem, searcher, rank)
  terminal.init()
})()
