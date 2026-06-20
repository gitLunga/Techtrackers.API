using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace TechTrackers.Data.Model.dto.ReportDto
{
    public class MonthlyReportDto
    {
        public string Month { get; set; }
        public int TotalIssues { get; set; }
        public int IssuesClosed { get; set; }
        public int IssuesOpen { get; set; }
        public string AvgResolutionTime { get; set; }
    }
}
