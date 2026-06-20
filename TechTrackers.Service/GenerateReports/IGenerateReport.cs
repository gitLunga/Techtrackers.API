using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using TechTrackers.Data.Model.dto.ReportDto;

namespace TechTrackers.Service.GenerateReports
{
    public interface IGenerateReport
    {
        Task<IEnumerable<IssueReportDto>> GetIssueByStatusReport();
        Task<IssueStatusCountDto> GetIssueStatusCount();
    }
}
