import { createRoot } from 'react-dom/client'
import { XiangqiReviewScreen } from '../components/XiangqiReviewScreen'
import { reviewPositions } from '../games/xiangqi/review'
import fixture from './fixtures/xiangqi-rook-blunder.json'
import '../design-tokens.css'
import '../styles.css'

const history = reviewPositions(fixture.moves).at(-1)!.history.map((move, index) => ({ ...move, ...fixture.evaluations[index], score: { kind: 'cp' as const, value: fixture.evaluations[index].score.value } }))
createRoot(document.getElementById('root')!).render(<XiangqiReviewScreen history={history} onClose={() => { window.location.href = '/' }} />)
