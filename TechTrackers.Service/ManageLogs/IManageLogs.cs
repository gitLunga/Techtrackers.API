using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using TechTrackers.Data.Model;
using TechTrackers.Data.Model.dto;

namespace TechTrackers.Service.ManageLogs
{
    public interface IManageLogs
    {
        Task<int> CountAllLogsAsync();
        Task<int> CountLogsByStatusAsync(string status);
        Task<IEnumerable<LogDetailDto>> GetOpenLogsAsync();
        Task<bool> OpenLog(int logId);
        Task<bool> CloseLog(int logId);
        Task<bool> ChangeLogStatus(string issueId, string newStatus, string? note);

        Task<Log> GetIssueByIdAsync(int id);

    }
}
