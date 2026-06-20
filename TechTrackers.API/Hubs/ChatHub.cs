
using Microsoft.AspNetCore.SignalR;

namespace TechTrackers.API.Hubs
{

        public class ChatHub : Hub
        {
            // ✅ Send message to all users in a specific log chat
            public async Task SendMessage(int logId, int senderId, string message)
            {
                // Broadcast the message to all users in the chat group
                await Clients.Group($"{logId}").SendAsync("ReceiveMessage", logId, senderId, message, DateTime.Now);
            }

            // ✅ When a user joins a log chat
            public async Task JoinLogChat(int logId)
            {
            if (logId <= 0) // ✅ Prevents invalid logId errors
            {
                throw new ArgumentException("Invalid log ID received.");
            }

            await Groups.AddToGroupAsync(Context.ConnectionId, $"{logId}");
            await Clients.Group($"{logId}").SendAsync("UserJoined", Context.ConnectionId, logId);
        }

            // ✅ When a user leaves a log chat
            public async Task LeaveLogChat(int logId)
            {
                await Groups.RemoveFromGroupAsync(Context.ConnectionId, $"{logId}");
            }
        }
}
