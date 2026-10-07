import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { ChessStudyPage } from '../games/chess/ChessStudyPage'
import { ChessGameEngine, replayChessState } from '../games/chess/rules'
import '../games/chess/chess.css'
const promotion=replayChessState([], {initialFen:'7k/P7/8/8/8/8/8/7K w - - 0 1'})
const base=replayChessState(['g1f3','g8f6','f3g1','f6g8','g1f3','g8f6','f3g1'])
const rules=new ChessGameEngine()
const claim=rules.getLegalActions(base).find(a=>a.kind==='claim-draw' && a.intendedMove?.from==='f6')!
const claimed=rules.executeAction(base,claim)
function Fixture(){ const [which,setWhich]=useState('promotion'); return <><button onClick={()=>setWhich('promotion')}>升变验收</button><button onClick={()=>setWhich('claim')}>声明和棋验收</button><ChessStudyPage key={which} entry={{state:which==='promotion'?promotion:claimed,source:'临时验收局面'}} /></> }
createRoot(document.getElementById('root')!).render(<Fixture />)
