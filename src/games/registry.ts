import { registerGame } from './GameRegistry'
import { goGameRegistration } from './go/registration'
import { xiangqiGameRegistration } from './xiangqi/registration'

registerGame(xiangqiGameRegistration)
registerGame(goGameRegistration)
