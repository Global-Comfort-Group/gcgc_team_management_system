import { NextResponse } from 'next/server'

/**
 * OpenAPI 3.1 spec for the public task API. Public (no auth) — contains no user
 * data. Agents/LLM tool frameworks import this to auto-generate the tool.
 */
export async function GET() {
  const server = process.env.NEXTAUTH_URL?.replace(/\/$/, '') ?? ''

  const spec = {
    openapi: '3.1.0',
    info: {
      title: 'GCGC TMS Public Task API',
      version: '1.0.0',
      description:
        'Create tasks (with optional nested subtasks) in the GCGC Team Management System. Authenticate with a personal API token generated on your profile page.',
    },
    servers: server ? [{ url: server }] : [],
    security: [{ bearerAuth: [] }],
    paths: {
      '/api/public/boards': {
        get: {
          operationId: 'listBoards',
          summary: 'List boards you can create tasks on',
          responses: {
            '200': {
              description: 'Your boards',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      boards: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            id: { type: 'string' },
                            name: { type: 'string' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            '401': { description: 'Invalid or missing API token' },
          },
        },
      },
      '/api/public/tasks': {
        post: {
          operationId: 'createTask',
          summary: 'Create a task (optionally with subtasks)',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CreateTask' },
              },
            },
          },
          responses: {
            '201': { description: 'Task created' },
            '400': { description: 'Validation error or unknown/inaccessible board' },
            '401': { description: 'Invalid or missing API token' },
            '429': { description: 'Rate limit exceeded' },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer' },
      },
      schemas: {
        CreateTask: {
          type: 'object',
          required: ['title'],
          properties: {
            title: { type: 'string', description: 'Task title (required)' },
            description: { type: 'string', description: 'Optional details' },
            dueDate: {
              type: 'string',
              description: 'Optional deadline: YYYY-MM-DD or full ISO datetime',
            },
            boardId: {
              type: 'string',
              description: 'Optional board id from GET /api/public/boards. Omit to leave the task unassigned to any board.',
            },
            assignTo: {
              type: 'string',
              enum: ['me'],
              description: 'Optional. "me" assigns the task to the token owner; omit to leave it unassigned.',
            },
            subtasks: {
              type: 'array',
              description: 'Optional subtasks, created together with the parent',
              items: {
                type: 'object',
                required: ['title'],
                properties: {
                  title: { type: 'string' },
                  description: { type: 'string' },
                  dueDate: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  }

  return NextResponse.json(spec)
}
