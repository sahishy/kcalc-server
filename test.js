import input_parser_agent from './agents/input_parser_agent.js'
import test_agent from './agents/test_agent.js'

console.log('getting response...')

const response = await test_agent('3 apples')

console.log(response)