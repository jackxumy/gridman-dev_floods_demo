import IAPI, { BaseResponse, SimulationEnv, DiscoverBaseResponse, ProcessGroupResponse, GetSimulationResultBaseRequest, ProcessGroupMeta, CreateSimulationMeta, SimulationResultMeta, SolutionMeta, StartSimulationMeta, StopSimulationMeta } from "./types";
import { getResourcePrefix } from './prefix'

const API_PREFIX = "/api/"

// Step 1: Create Solution: /api/solution/create
export const createSolution: IAPI<SolutionMeta, BaseResponse> = {
    api: `${API_PREFIX}`,
    fetch: async (solution: SolutionMeta, isResource: boolean): Promise<BaseResponse> => {
        try {
            const api = getResourcePrefix(isResource) + createSolution.api + 'solution/create'
            console.log(api)
            const response = await fetch(api, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(solution)
            })

            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`)
            }

            const responseData: BaseResponse = await response.json()
            return responseData
        } catch (error) {
            throw new Error(`Failed to create solution: ${error}`)
        }
    }
}

// Step 2: Discover: /api/proxy/discover
export const discoverProxy: IAPI<string, DiscoverBaseResponse> = {
    api: `${API_PREFIX}`,
    fetch: async (node_key: string, isResource: boolean): Promise<DiscoverBaseResponse> => {
        try {
            const api = getResourcePrefix(isResource) + discoverProxy.api + 'proxy/discover'
            const response = await fetch(api, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ node_key })
            })

            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`)
            }

            const responseData: DiscoverBaseResponse = await response.json()
            return responseData
        } catch (error) {
            throw new Error(`Failed to discover proxy: ${error}`)
        }
    }
}

// Step 3: Clone env: /api/model/clone_env
export const cloneEnv: IAPI<SimulationEnv, string> = {
    api: `${API_PREFIX}`,
    fetch: async (solution: SimulationEnv, isResource: boolean): Promise<string> => {
        try {
            const api = getResourcePrefix(isResource) + cloneEnv.api + 'model/clone_env'
            const response = await fetch(api, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(solution)
            })

            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`)
            }

            const responseData: string = (await response.json()).task_id
            return responseData
        } catch (error) {
            throw new Error(`Failed to clone env: ${error}`)
        }
    }
}

// Step 4: Get Clone Progress: /api/model/clone_progress/{task_id}
export const cloneProgress: IAPI<string, string> = {
    api: `${API_PREFIX}`,
    fetch: async (task_id: string, isResource: boolean): Promise<string> => {
        try {
            const api = getResourcePrefix(isResource) + cloneProgress.api + 'model/clone_progress/' + task_id
            const response = await fetch(api, {
                method: 'GET',
            })

            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`)
            }

            const responseData: string = await response.json()
            return responseData
        } catch (error) {
            throw new Error(`Failed to get clone progress: ${error}`)
        }
    }
}

// Step 5: Create Simulation: /api/simulation/create
export const createSimulation: IAPI<CreateSimulationMeta, BaseResponse> = {
    api: `${API_PREFIX}`,
    fetch: async (simulation: CreateSimulationMeta, isResource: boolean): Promise<BaseResponse> => {
        try {
            const api = getResourcePrefix(isResource) + createSimulation.api + 'simulation/create'
            console.log(api)
            const response = await fetch(api, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(simulation)
            })

            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`)
            }

            const responseData: BaseResponse = await response.json()
            return responseData
        } catch (error) {
            throw new Error(`Failed to create simulation: ${error}`)
        }
    }
}

// Step 6: Build Process Group: /api/model/build_process_group
export const buildProcessGroup: IAPI<ProcessGroupMeta, ProcessGroupResponse> = {
    api: `${API_PREFIX}`,
    fetch: async (process_group: ProcessGroupMeta, isResource: boolean): Promise<ProcessGroupResponse> => {
        try {
            const api = getResourcePrefix(isResource) + buildProcessGroup.api + 'model/build_process_group'
            const response = await fetch(api, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(process_group)
            })

            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`)
            }

            const responseData: ProcessGroupResponse = await response.json()
            return responseData
        } catch (error) {
            throw new Error(`Failed to build process group: ${error}`)
        }
    }
}

// Step 7: Start Simulation: /api/model/start_simulation
export const startSimulation: IAPI<StartSimulationMeta, string> = {
    api: `${API_PREFIX}`,
    fetch: async (simulation: StartSimulationMeta, isResource: boolean): Promise<string> => {
        try {
            const api = getResourcePrefix(isResource) + startSimulation.api + 'model/start_simulation'
            const response = await fetch(api, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(simulation)
            })

            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`)
            }

            const responseData: string = (await response.json()).result
            return responseData
        } catch (error) {
            throw new Error(`Failed to start simulation: ${error}`)
        }
    }
}

// Step 8: Get Result: /api/simulation/result/{simulation_name}/{step}
export const getSimulationResult: IAPI<GetSimulationResultBaseRequest, SimulationResultMeta> = {
    api: `${API_PREFIX}`,
    fetch: async (request: GetSimulationResultBaseRequest, isResource: boolean): Promise<SimulationResultMeta> => {
        try {
            const api = getResourcePrefix(isResource) + getSimulationResult.api + 'simulation/result'
            const response = await fetch(`${api}/${request.simulation_name}/${request.step}`, { method: 'GET' })

            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`)
            }

            const simulationResult: SimulationResultMeta = await response.json()
            return simulationResult
        } catch (error) {
            throw new Error(`Failed to get simulation result: ${error}`)
        }
    }
}
// Step 9: Stop Simulation: /api/model/stop_simulation
export const stopSimulation: IAPI<StopSimulationMeta, string> = {
    api: `${API_PREFIX}`,
    fetch: async (simulation_env: StopSimulationMeta, isResource: boolean): Promise<string> => {
        try {
            const api = getResourcePrefix(isResource) + stopSimulation.api + 'model/stop_simulation'
            const response = await fetch(api, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(simulation_env)
            })

            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`)
            }

            const responseData: string = (await response.json()).result
            return responseData
        } catch (error) {
            throw new Error(`Failed to stop simulation: ${error}`)
        }
    }
}