import { registerGame } from './GameRegistry'
import { goGameRegistration } from './go/registration'
import { xiangqiGameRegistration } from './xiangqi/registration'
import { chessGameRegistration } from './chess/registration'

registerGame(xiangqiGameRegistration)
registerGame(goGameRegistration)
registerGame(chessGameRegistration)
